import type { Plan, ExecutionTurn } from "./types.ts";

const API_BASE = "/api";

export async function apiChat(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  currentPlan: Plan | null,
): Promise<{ plan: Plan | null; message: string }> {
  const res = await fetch(`${API_BASE}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, currentPlan }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err || `Chat failed (${res.status})`);
  }
  return res.json();
}

export async function apiGeneratePlan(goal: string): Promise<Plan> {
  const res = await fetch(`${API_BASE}/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ goal }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err || `Plan generation failed (${res.status})`);
  }
  return res.json();
}

export async function apiExecutePlan(plan: Plan): Promise<{ runId: string; totalTurns: number }> {
  const res = await fetch(`${API_BASE}/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(plan),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err || `Execution start failed (${res.status})`);
  }
  return res.json();
}

export async function apiStopRun(runId: string): Promise<{ ok: boolean }> {
  const res = await fetch(`${API_BASE}/runs/${runId}/stop`, { method: "POST" });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err || `Stop failed (${res.status})`);
  }
  return res.json();
}

export async function apiResumeRun(runId: string): Promise<{ ok: boolean; resumeFromRound?: number }> {
  const res = await fetch(`${API_BASE}/runs/${runId}/resume`, { method: "POST" });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err || `Resume failed (${res.status})`);
  }
  return res.json();
}

export async function apiGetRuns(): Promise<
  Array<{
    id: string;
    goal: string;
    startedAt: number;
    finishedAt?: number;
    status: string;
    rounds?: number;
    currentRound?: number;
    turns: ExecutionTurn[];
  }>
> {
  const res = await fetch(`${API_BASE}/runs`);
  if (!res.ok) throw new Error(`Failed to fetch runs`);
  return res.json();
}

export type WsMessage =
  | { type: "turn:start"; runId: string; turnIndex: number; agentId: string; agentName: string; round: number }
  | { type: "turn:done"; runId: string; turnIndex: number; agentId: string; agentName: string; round: number; ok: boolean; reply: string; durationMs: number }
  | { type: "round:start"; runId: string; round: number; totalRounds: number }
  | { type: "run:done"; runId: string; status: "completed" | "failed" | "stopped" }
  | { type: "run:resumed"; runId: string }
  | { type: "error"; message: string };

export function connectWebSocket(onMessage: (msg: WsMessage) => void): WebSocket {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${proto}//${location.host}/ws`);
  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      onMessage(msg);
    } catch {
      // ignore malformed messages
    }
  };
  return ws;
}
