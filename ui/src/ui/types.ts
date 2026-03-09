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
  agentId: string;
  ok: boolean;
  reply: string;
  durationMs: number;
};

export type TurnStatus = "pending" | "running" | "done" | "failed";

export type ExecutionTurn = {
  round: number;
  agentId: string;
  agentName: string;
  index: number;
  status: TurnStatus;
  result?: TurnResult;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
};

export type Tab = "main" | "execution" | "history";

export type ThemeMode = "dark" | "light" | "system";

export type ExecutionRun = {
  id: string;
  goal: string;
  startedAt: number;
  finishedAt?: number;
  turns: ExecutionTurn[];
  status: "running" | "completed" | "failed" | "stopped";
};
