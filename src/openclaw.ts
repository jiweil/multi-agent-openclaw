import { llmChat } from "./llm.js";

const AGENT_SYSTEM_PROMPT = `You are an AI agent executing a specific task within a multi-agent workflow.

Rules:
- Complete your task fully in a SINGLE response. Never ask for clarification or more information.
- Work with whatever information you have. Use your knowledge to fill gaps.
- Produce substantive, actionable output — not templates or frameworks.
- If the task is research or analysis, provide real insights, data points, and conclusions.
- Do not say "I'd be happy to" or "please provide". Just do the work.
- Your output will be consumed by other agents downstream, so be thorough and specific.`;

const sessionHistories = new Map<string, Array<{ role: "user" | "assistant"; content: string }>>();

/**
 * Execute an agent turn by calling the configured LLM provider.
 * Maintains per-session conversation history for multi-turn context.
 */
export async function callAgent(opts: {
  agentId: string;
  message: string;
  sessionId?: string;
  timeoutMs?: number;
}): Promise<{ ok: boolean; reply: string; durationMs: number }> {
  const start = Date.now();
  const sessionKey = opts.sessionId ?? opts.agentId;

  try {
    const history = sessionHistories.get(sessionKey) ?? [];
    history.push({ role: "user", content: opts.message });

    const model = process.env.EXECUTION_MODEL ?? process.env.LLM_MODEL;
    const response = await llmChat({
      system: AGENT_SYSTEM_PROMPT,
      messages: history,
      model: model || undefined,
      maxTokens: 4096,
    });

    const text = response.text;

    history.push({ role: "assistant", content: text });
    sessionHistories.set(sessionKey, history);

    const durationMs = Date.now() - start;
    return { ok: true, reply: text || "(empty response)", durationMs };
  } catch (err) {
    const durationMs = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, reply: message, durationMs };
  }
}
