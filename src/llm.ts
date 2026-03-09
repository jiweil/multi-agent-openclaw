/**
 * Unified LLM provider abstraction.
 *
 * Supports:
 *  - anthropic     (Anthropic API)
 *  - openai        (OpenAI API)
 *  - google        (Google Gemini)
 *  - Any OpenAI-compatible provider via LLM_BASE_URL:
 *    groq, openrouter, together, cerebras, mistral, ollama, vllm, xai, etc.
 */

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";

export type LlmResponse = {
  text: string;
};

type Provider = "anthropic" | "openai" | "google" | "openai-compatible";

function detectProvider(): Provider {
  const explicit = process.env.LLM_PROVIDER?.toLowerCase();
  if (explicit) {
    if (explicit === "anthropic") return "anthropic";
    if (explicit === "openai") return "openai";
    if (explicit === "google" || explicit === "gemini") return "google";
    return "openai-compatible";
  }

  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) return "google";
  if (process.env.LLM_BASE_URL) return "openai-compatible";

  return "anthropic";
}

function getDefaultModel(provider: Provider): string {
  switch (provider) {
    case "anthropic": return "claude-sonnet-4-20250514";
    case "openai": return "gpt-4o";
    case "google": return "gemini-2.0-flash";
    case "openai-compatible": return "default";
  }
}

function getApiKey(provider: Provider): string {
  const key = process.env.LLM_API_KEY;
  if (key) return key;

  switch (provider) {
    case "anthropic": return process.env.ANTHROPIC_API_KEY ?? "";
    case "openai": return process.env.OPENAI_API_KEY ?? "";
    case "google": return process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? "";
    case "openai-compatible":
      return process.env.GROQ_API_KEY
        ?? process.env.OPENROUTER_API_KEY
        ?? process.env.TOGETHER_API_KEY
        ?? process.env.MISTRAL_API_KEY
        ?? process.env.XAI_API_KEY
        ?? process.env.LLM_API_KEY
        ?? "";
  }
}

async function callAnthropic(opts: {
  model: string;
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  maxTokens: number;
}): Promise<LlmResponse> {
  const client = new Anthropic({ apiKey: getApiKey("anthropic") || undefined });
  const response = await client.messages.create({
    model: opts.model,
    max_tokens: opts.maxTokens,
    system: opts.system,
    messages: opts.messages,
  });
  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n\n");
  return { text };
}

async function callOpenAI(opts: {
  model: string;
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  maxTokens: number;
  baseURL?: string;
  apiKey?: string;
}): Promise<LlmResponse> {
  const client = new OpenAI({
    apiKey: opts.apiKey || getApiKey("openai") || undefined,
    baseURL: opts.baseURL,
  });
  const response = await client.chat.completions.create({
    model: opts.model,
    max_tokens: opts.maxTokens,
    messages: [
      { role: "system", content: opts.system },
      ...opts.messages,
    ],
  });
  const text = response.choices[0]?.message?.content ?? "";
  return { text };
}

async function callGoogle(opts: {
  model: string;
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  maxTokens: number;
}): Promise<LlmResponse> {
  const apiKey = getApiKey("google");
  const ai = new GoogleGenAI({ apiKey });
  const contents = opts.messages.map((m) => ({
    role: m.role === "assistant" ? "model" as const : "user" as const,
    parts: [{ text: m.content }],
  }));
  const response = await ai.models.generateContent({
    model: opts.model,
    config: {
      systemInstruction: opts.system,
      maxOutputTokens: opts.maxTokens,
    },
    contents,
  });
  const text = response.text ?? "";
  return { text };
}

/**
 * Send a message to the configured LLM provider.
 */
export async function llmChat(opts: {
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  model?: string;
  maxTokens?: number;
}): Promise<LlmResponse> {
  const provider = detectProvider();
  const model = opts.model ?? process.env.LLM_MODEL ?? getDefaultModel(provider);
  const maxTokens = opts.maxTokens ?? 4096;

  switch (provider) {
    case "anthropic":
      return callAnthropic({ model, system: opts.system, messages: opts.messages, maxTokens });

    case "openai":
      return callOpenAI({ model, system: opts.system, messages: opts.messages, maxTokens });

    case "google":
      return callGoogle({ model, system: opts.system, messages: opts.messages, maxTokens });

    case "openai-compatible": {
      const baseURL = process.env.LLM_BASE_URL;
      if (!baseURL) throw new Error("LLM_BASE_URL is required for openai-compatible providers");
      const apiKey = getApiKey("openai-compatible");
      return callOpenAI({ model, system: opts.system, messages: opts.messages, maxTokens, baseURL, apiKey });
    }
  }
}

/**
 * Return a human-readable description of the active provider config.
 */
export function describeProvider(): string {
  const provider = detectProvider();
  const model = process.env.LLM_MODEL ?? getDefaultModel(provider);
  const base = process.env.LLM_BASE_URL;
  if (provider === "openai-compatible" && base) {
    return `${process.env.LLM_PROVIDER ?? "openai-compatible"} (${model}) @ ${base}`;
  }
  return `${provider} (${model})`;
}
