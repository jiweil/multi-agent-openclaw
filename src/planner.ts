import Anthropic from "@anthropic-ai/sdk";
import { callAgent } from "./openclaw.js";

export type Agent = {
  id: string;
  name: string;
  role: string;
  goal: string;
};

export type Plan = {
  goal: string;
  agents: Agent[];
  rounds: number;
};

export type TurnResult = {
  ok: boolean;
  reply: string;
  durationMs: number;
};

const PLAN_SYSTEM_PROMPT = `You are a task planner for coordinating multiple AI agents.

The user will describe a scenario. Your job is to:
1. Identify all agents needed — each with a clear role and goal
2. Decide how many rounds of interaction are needed

IMPORTANT: You do NOT plan individual steps or instructions. Each agent has a high-level goal, and during execution they will dynamically react to what other agents have said/done in prior rounds.

Return ONLY valid JSON (no markdown fences, no commentary):
{
  "agents": [
    { "id": "short-id", "name": "Display Name", "role": "brief expertise description", "goal": "what this agent should achieve overall" }
  ],
  "rounds": 3
}

Rules:
- id = short lowercase identifier (letters/hyphens only)
- name = human-readable display name
- role = brief description of expertise/responsibility
- goal = the agent's objective for the entire scenario (1-3 sentences). This is NOT a step-by-step instruction — it's what the agent is trying to accomplish. The agent will see everything that happens and adapt.
- rounds = number of interaction rounds. Each round, every agent speaks once based on what's happened so far.
  Examples of round counts:
  - Simple research/analysis: 1-2 rounds
  - Debate: 3-5 rounds (opening → rebuttals → closing)
  - Negotiation: 3-4 rounds
  - Social media drama: 3-6 rounds (escalation arc)
  - Collaborative project: 2-3 rounds (draft → feedback → finalize)`;

export async function generatePlan(opts: {
  goal: string;
  model?: string;
}): Promise<Plan> {
  const client = new Anthropic();

  const response = await client.messages.create({
    model: opts.model ?? "claude-sonnet-4-20250514",
    max_tokens: 4096,
    system: PLAN_SYSTEM_PROMPT,
    messages: [{ role: "user", content: opts.goal }],
  });

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");

  const parsed = JSON.parse(text);

  const agents: Agent[] = (parsed.agents ?? []).map((a: Record<string, string>) => ({
    id: a.id,
    name: a.name ?? a.id,
    role: a.role ?? "",
    goal: a.goal ?? "",
  }));

  return { goal: opts.goal, agents, rounds: parsed.rounds ?? 1 };
}

/* ─── Multi-turn conversational planner ─── */

const CHAT_SYSTEM_PROMPT = `You are a conversational task planner for coordinating multiple AI agents.

You help the user design and refine multi-agent scenarios through natural conversation.

The user may:
- Describe a new scenario → create a plan
- Request modifications → update accordingly
- Ask questions → respond helpfully

ALWAYS respond with ONLY valid JSON (no markdown fences, no text outside JSON):
{
  "message": "Brief, friendly response (1-3 sentences)",
  "plan": { ... } or null
}

Plan format:
{
  "goal": "one-sentence summary",
  "agents": [{ "id": "short-id", "name": "Display Name", "role": "brief expertise", "goal": "overall objective for this agent" }],
  "rounds": 3
}

IMPORTANT: You do NOT plan individual steps or instructions. Each agent has a high-level goal and will dynamically react to what other agents say during execution.

Rules:
- Return the FULL updated plan when creating or modifying
- Set "plan" to null only if no plan exists yet and user hasn't described a task
- id = short lowercase (letters/hyphens), name = display name, role = expertise, goal = what the agent is trying to achieve (1-3 sentences)
- rounds = number of interaction rounds. Each round, every agent speaks once.
  - Simple analysis: 1-2 rounds
  - Debate/negotiation: 3-5 rounds
  - Drama/escalation: 3-6 rounds
  - Collaborative: 2-3 rounds`;

export async function chatPlan(opts: {
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  currentPlan?: Plan | null;
  model?: string;
}): Promise<{ plan: Plan | null; message: string }> {
  const client = new Anthropic();

  let system = CHAT_SYSTEM_PROMPT;
  if (opts.currentPlan) {
    system += `\n\nCurrent plan:\n${JSON.stringify(opts.currentPlan, null, 2)}`;
  }

  const response = await client.messages.create({
    model: opts.model ?? "claude-sonnet-4-20250514",
    max_tokens: 4096,
    system,
    messages: opts.messages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
  });

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");

  const parsed = JSON.parse(text);

  if (!parsed.plan) {
    return { plan: opts.currentPlan ?? null, message: parsed.message ?? text };
  }

  const agents: Agent[] = (parsed.plan.agents ?? []).map((a: Record<string, string>) => ({
    id: a.id,
    name: a.name ?? a.id,
    role: a.role ?? "",
    goal: a.goal ?? "",
  }));

  const goal = parsed.plan.goal ?? opts.messages[0]?.content ?? "";

  return {
    plan: { goal, agents, rounds: parsed.plan.rounds ?? 1 },
    message: parsed.message ?? "Plan updated.",
  };
}

/* ─── Execution engine ─── */

export type Turn = {
  round: number;
  agentId: string;
  agentName: string;
};

/**
 * Execute a plan round-by-round. Each round, every agent is called with
 * their goal plus the full transcript of all prior rounds. Agents react
 * dynamically rather than following scripted instructions.
 */
export async function executePlan(plan: Plan, opts?: {
  onTurn?: (turn: Turn, result: TurnResult, index: number) => void;
  onTurnStart?: (turn: Turn, index: number) => void;
  onRoundStart?: (round: number, totalRounds: number) => void;
  signal?: AbortSignal;
  sessionPrefix?: string;
}): Promise<{ results: Array<{ turn: Turn } & TurnResult>; stopped: boolean }> {
  const allResults: Array<{ turn: Turn } & TurnResult> = [];
  const sessionPrefix = opts?.sessionPrefix ?? `run-${Date.now()}`;
  const transcript: Array<{ round: number; agentId: string; agentName: string; content: string }> = [];
  let globalIndex = 0;
  let stopped = false;

  for (let round = 1; round <= plan.rounds; round++) {
    if (opts?.signal?.aborted) { stopped = true; break; }

    opts?.onRoundStart?.(round, plan.rounds);
    console.log(`\n  ── Round ${round}/${plan.rounds} ──`);

    const roundResults = await Promise.all(
      plan.agents.map(async (agent) => {
        if (opts?.signal?.aborted) {
          return { agent, ok: false, reply: "Stopped", durationMs: 0, index: globalIndex++ };
        }

        const turn: Turn = { round, agentId: agent.id, agentName: agent.name };
        const actualIndex = globalIndex++;
        opts?.onTurnStart?.(turn, actualIndex);

        let message = `You are "${agent.name}" (${agent.role}).\n\nYour goal: ${agent.goal}`;
        message += `\n\nOverall scenario: ${plan.goal}`;
        message += `\n\nThis is round ${round} of ${plan.rounds}.`;

        if (transcript.length > 0) {
          message += `\n\n--- Transcript of what has happened so far ---`;
          for (const entry of transcript) {
            message += `\n\n[Round ${entry.round}] ${entry.agentName}:\n${entry.content}`;
          }
          message += `\n\n--- End of transcript ---`;
          message += `\n\nBased on everything above, continue pursuing your goal. React to what others have said. Be substantive and specific.`;
        } else {
          message += `\n\nThis is the opening round. Begin pursuing your goal. Be substantive and specific.`;
        }

        console.log(`  → [R${round}] ${agent.name} (${agent.id})...`);

        const sessionId = `${sessionPrefix}-${agent.id}`;
        const result = await callAgent({
          agentId: agent.id,
          message,
          sessionId,
        });

        opts?.onTurn?.(turn, result, actualIndex);
        return { agent, turn, actualIndex, ...result };
      })
    );

    for (const r of roundResults) {
      if (r.reply !== "Stopped") {
        transcript.push({
          round,
          agentId: r.agent.id,
          agentName: r.agent.name,
          content: r.reply.slice(0, 4000),
        });
      }
      allResults.push({
        turn: { round, agentId: r.agent.id, agentName: r.agent.name },
        ok: r.ok,
        reply: r.reply,
        durationMs: r.durationMs,
      });
    }

    if (opts?.signal?.aborted) { stopped = true; break; }
  }

  return { results: allResults, stopped };
}
