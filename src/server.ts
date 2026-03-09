import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./env.js";

loadEnv();

import { generatePlan, chatPlan, executePlan, type Plan, type Turn } from "./planner.js";
import { saveRun, loadAllRuns } from "./history.js";
import { describeProvider } from "./llm.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

type TurnRecord = Turn & {
  index: number;
  status: "pending" | "running" | "done" | "failed";
  result?: { agentId: string; ok: boolean; reply: string; durationMs: number };
};

type RunRecord = {
  id: string;
  goal: string;
  plan: Plan;
  startedAt: number;
  finishedAt?: number;
  status: "running" | "completed" | "failed" | "stopped";
  rounds: number;
  currentRound: number;
  turns: TurnRecord[];
};

const runs: RunRecord[] = loadAllRuns() as RunRecord[];
const runAbortControllers = new Map<string, AbortController>();
const wsClients = new Set<WebSocket>();
let runCounter = runs.length;
console.log(`[History] Loaded ${runs.length} past runs from disk`);

function broadcast(data: unknown) {
  const json = JSON.stringify(data);
  for (const client of wsClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(json);
    }
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

function json(res: ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function error(res: ServerResponse, message: string, status = 400) {
  res.writeHead(status, { "Content-Type": "text/plain" });
  res.end(message);
}

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function serveStatic(res: ServerResponse, urlPath: string) {
  const distDir = join(__dirname, "..", "dist", "ui");
  let filePath = join(distDir, urlPath === "/" ? "index.html" : urlPath);

  if (!existsSync(filePath)) {
    filePath = join(distDir, "index.html");
  }
  if (!existsSync(filePath)) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const ext = extname(filePath);
  const mime = MIME_TYPES[ext] || "application/octet-stream";
  const content = readFileSync(filePath);
  res.writeHead(200, { "Content-Type": mime });
  res.end(content);
}

async function handleRequest(req: IncomingMessage, res: ServerResponse) {
  const url = req.url ?? "/";
  const method = req.method ?? "GET";

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  /* ── Single-shot plan generation ── */
  if (url === "/api/plan" && method === "POST") {
    try {
      const body = JSON.parse(await readBody(req));
      const { goal } = body as { goal: string };
      if (!goal) return error(res, "Missing goal");
      console.log(`[API] Generating plan for: "${goal.slice(0, 100)}..."`);
      const plan = await generatePlan({ goal });
      console.log(`[API] Plan generated: ${plan.agents.length} agents, ${plan.rounds} rounds`);
      return json(res, plan);
    } catch (err) {
      console.error("[API] Plan error:", err);
      return error(res, err instanceof Error ? err.message : String(err), 500);
    }
  }

  /* ── Multi-turn chat plan ── */
  if (url === "/api/chat" && method === "POST") {
    try {
      const body = JSON.parse(await readBody(req));
      const { messages, currentPlan } = body;
      if (!messages?.length) return error(res, "Missing messages");
      console.log(`[API] Chat: ${messages.length} messages`);
      const result = await chatPlan({ messages, currentPlan });
      console.log(`[API] Chat response: plan=${!!result.plan}, msg="${result.message.slice(0, 80)}"`);
      return json(res, result);
    } catch (err) {
      console.error("[API] Chat error:", err);
      return error(res, err instanceof Error ? err.message : String(err), 500);
    }
  }

  /* ── Execute plan ── */
  if (url === "/api/execute" && method === "POST") {
    try {
      const plan = JSON.parse(await readBody(req)) as Plan;
      if (!plan.agents?.length) return error(res, "Plan has no agents");

      const runId = `run-${++runCounter}-${Date.now()}`;
      const totalTurns = plan.agents.length * plan.rounds;

      const run: RunRecord = {
        id: runId,
        goal: plan.goal,
        plan,
        startedAt: Date.now(),
        status: "running",
        rounds: plan.rounds,
        currentRound: 1,
        turns: [],
      };

      let idx = 0;
      for (let r = 1; r <= plan.rounds; r++) {
        for (const agent of plan.agents) {
          run.turns.push({
            round: r,
            agentId: agent.id,
            agentName: agent.name,
            index: idx++,
            status: "pending" as const,
          });
        }
      }

      const abortController = new AbortController();
      runAbortControllers.set(runId, abortController);

      runs.push(run);
      json(res, { runId, totalTurns });

      setImmediate(async () => {
        try {
          const execResult = await executePlan(plan, {
            signal: abortController.signal,
            onRoundStart: (round, totalRounds) => {
              run.currentRound = round;
              broadcast({ type: "round:start", runId, round, totalRounds });
            },
            onTurnStart: (turn, index) => {
              if (run.turns[index]) run.turns[index].status = "running";
              broadcast({ type: "turn:start", runId, turnIndex: index, agentId: turn.agentId, agentName: turn.agentName, round: turn.round });
            },
            onTurn: (turn, result, index) => {
              const status = result.ok ? "done" : "failed";
              if (run.turns[index]) {
                run.turns[index].status = status as "done" | "failed";
                run.turns[index].result = {
                  agentId: turn.agentId,
                  ok: result.ok,
                  reply: result.reply.slice(0, 10000),
                  durationMs: result.durationMs,
                };
              }
              broadcast({
                type: "turn:done",
                runId,
                turnIndex: index,
                agentId: turn.agentId,
                agentName: turn.agentName,
                round: turn.round,
                ok: result.ok,
                reply: result.reply.slice(0, 10000),
                durationMs: result.durationMs,
              });
            },
          });
          if (execResult.stopped) {
            run.status = "stopped";
            for (const t of run.turns) {
              if (t.status === "running" || t.status === "pending") t.status = "pending";
            }
          } else {
            run.status = run.turns.some((t) => t.status === "failed") ? "failed" : "completed";
          }
          run.finishedAt = Date.now();
          runAbortControllers.delete(runId);
          saveRun(run as unknown as Record<string, unknown>);
          broadcast({ type: "run:done", runId, status: run.status });
          console.log(`[API] Run ${runId} finished: ${run.status}`);
        } catch (err) {
          run.status = "failed";
          run.finishedAt = Date.now();
          runAbortControllers.delete(runId);
          saveRun(run as unknown as Record<string, unknown>);
          const message = err instanceof Error ? err.message : String(err);
          broadcast({ type: "error", runId, message });
          console.error(`[API] Run ${runId} error:`, message);
        }
      });
    } catch (err) {
      return error(res, err instanceof Error ? err.message : String(err), 500);
    }
    return;
  }

  /* ── Stop a running execution ── */
  if (url.startsWith("/api/runs/") && url.endsWith("/stop") && method === "POST") {
    const runId = url.slice("/api/runs/".length, -"/stop".length);
    const controller = runAbortControllers.get(runId);
    if (!controller) {
      const run = runs.find((r) => r.id === runId);
      if (!run) return error(res, "Run not found", 404);
      return error(res, `Run is not active (status: ${run.status})`, 400);
    }
    controller.abort();
    console.log(`[API] Stopping run ${runId}`);
    return json(res, { ok: true });
  }

  /* ── Resume a stopped execution ── */
  if (url.startsWith("/api/runs/") && url.endsWith("/resume") && method === "POST") {
    const runId = url.slice("/api/runs/".length, -"/resume".length);
    const run = runs.find((r) => r.id === runId);
    if (!run) return error(res, "Run not found", 404);
    if (run.status !== "stopped") return error(res, `Cannot resume: status is ${run.status}`, 400);

    const completedRounds = new Set(
      run.turns.filter((t) => t.status === "done").map((t) => t.round)
    );
    const maxCompletedRound = completedRounds.size > 0 ? Math.max(...completedRounds) : 0;

    const allAgentsDoneForRound = (r: number) =>
      run.plan.agents.every((a) =>
        run.turns.some((t) => t.round === r && t.agentId === a.id && t.status === "done")
      );

    let resumeFromRound = 1;
    for (let r = 1; r <= maxCompletedRound; r++) {
      if (allAgentsDoneForRound(r)) resumeFromRound = r + 1;
      else break;
    }

    if (resumeFromRound > run.plan.rounds) {
      run.status = "completed";
      run.finishedAt = Date.now();
      saveRun(run as unknown as Record<string, unknown>);
      return json(res, { ok: true, message: "All rounds already completed" });
    }

    const resumePlan: Plan = { ...run.plan, rounds: run.plan.rounds - resumeFromRound + 1 };
    run.status = "running";
    run.finishedAt = undefined;

    const abortController = new AbortController();
    runAbortControllers.set(runId, abortController);

    broadcast({ type: "run:resumed", runId });
    json(res, { ok: true, resumeFromRound });

    setImmediate(async () => {
      try {
        const execResult = await executePlan(resumePlan, {
          signal: abortController.signal,
          sessionPrefix: runId,
          onRoundStart: (round, totalRounds) => {
            const actualRound = round + resumeFromRound - 1;
            run.currentRound = actualRound;
            broadcast({ type: "round:start", runId, round: actualRound, totalRounds: run.plan.rounds });
          },
          onTurnStart: (turn, _index) => {
            const actualRound = turn.round + resumeFromRound - 1;
            const idx = run.turns.findIndex((t) => t.round === actualRound && t.agentId === turn.agentId);
            if (idx !== -1) run.turns[idx].status = "running";
            broadcast({ type: "turn:start", runId, turnIndex: idx !== -1 ? idx : _index, agentId: turn.agentId, agentName: turn.agentName, round: actualRound });
          },
          onTurn: (turn, result, _index) => {
            const actualRound = turn.round + resumeFromRound - 1;
            const idx = run.turns.findIndex((t) => t.round === actualRound && t.agentId === turn.agentId);
            const status = result.ok ? "done" : "failed";
            if (idx !== -1) {
              run.turns[idx].status = status as "done" | "failed";
              run.turns[idx].result = {
                agentId: turn.agentId,
                ok: result.ok,
                reply: result.reply.slice(0, 10000),
                durationMs: result.durationMs,
              };
            }
            broadcast({
              type: "turn:done",
              runId,
              turnIndex: idx !== -1 ? idx : _index,
              agentId: turn.agentId,
              agentName: turn.agentName,
              round: actualRound,
              ok: result.ok,
              reply: result.reply.slice(0, 10000),
              durationMs: result.durationMs,
            });
          },
        });

        if (execResult.stopped) {
          run.status = "stopped";
          for (const t of run.turns) {
            if (t.status === "running" || t.status === "pending") t.status = "pending";
          }
        } else {
          run.status = run.turns.some((t) => t.status === "failed") ? "failed" : "completed";
        }
        run.finishedAt = Date.now();
        runAbortControllers.delete(runId);
        saveRun(run as unknown as Record<string, unknown>);
        broadcast({ type: "run:done", runId, status: run.status });
        console.log(`[API] Run ${runId} resumed and finished: ${run.status}`);
      } catch (err) {
        run.status = "failed";
        run.finishedAt = Date.now();
        runAbortControllers.delete(runId);
        saveRun(run as unknown as Record<string, unknown>);
        const message = err instanceof Error ? err.message : String(err);
        broadcast({ type: "error", runId, message });
        console.error(`[API] Run ${runId} resume error:`, message);
      }
    });
    return;
  }

  /* ── List runs ── */
  if (url === "/api/runs" && method === "GET") {
    return json(res, runs.map((r) => ({
      id: r.id,
      goal: r.goal,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
      status: r.status,
      rounds: r.rounds,
      currentRound: r.currentRound,
      turns: r.turns,
    })));
  }

  /* ── Provider info ── */
  if (url === "/api/provider" && method === "GET") {
    return json(res, { provider: describeProvider() });
  }

  serveStatic(res, url);
}

export function startServer(port = 3100) {
  const server = createServer((req, res) => {
    handleRequest(req, res).catch((err) => {
      console.error("Request error:", err);
      res.writeHead(500);
      res.end("Internal Server Error");
    });
  });

  const wss = new WebSocketServer({ server, path: "/ws" });
  wss.on("connection", (ws) => {
    wsClients.add(ws);
    ws.on("close", () => wsClients.delete(ws));
  });

  server.listen(port, () => {
    console.log(`\n  Multi-Agent OpenClaw Server`);
    console.log(`  ─────────────────────`);
    console.log(`  Provider: ${describeProvider()}`);
    console.log(`  API:  http://localhost:${port}/api`);
    console.log(`  UI:   http://localhost:${port}`);
    console.log(`  WS:   ws://localhost:${port}/ws\n`);
  });

  return server;
}

const port = parseInt(process.env.PORT ?? "3100", 10);
startServer(port);
