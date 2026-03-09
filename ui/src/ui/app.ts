import { LitElement, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { icons } from "./icons.ts";
import { renderChat } from "./views/chat.ts";
import { renderPlanPanel } from "./views/plan.ts";
import { renderExecution } from "./views/execution.ts";
import { renderHistory } from "./views/history.ts";
import { apiChat, apiExecutePlan, apiGetRuns, apiStopRun, apiResumeRun, connectWebSocket, type WsMessage } from "./api.ts";
import type {
  Plan,
  Tab,
  ThemeMode,
  ChatMessage,
  ExecutionTurn,
  ExecutionRun,
} from "./types.ts";

const NAV_ITEMS: Array<{ tab: Tab; label: string; icon: keyof typeof icons }> = [
  { tab: "main", label: "Planner", icon: "chat" },
  { tab: "execution", label: "Execution", icon: "play" },
  { tab: "history", label: "History", icon: "history" },
];

function loadTheme(): ThemeMode {
  return (localStorage.getItem("conductor-theme") as ThemeMode) ?? "dark";
}

const STORAGE_KEY = "mac-session";

function saveSession(messages: ChatMessage[], plan: Plan | null) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ messages, plan }));
  } catch { /* quota exceeded, ignore */ }
}

function loadSession(): { messages: ChatMessage[]; plan: Plan | null } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { messages: [], plan: null };
    const data = JSON.parse(raw);
    return { messages: data.messages ?? [], plan: data.plan ?? null };
  } catch {
    return { messages: [], plan: null };
  }
}

function applyThemeToDocument(mode: ThemeMode) {
  const resolved = mode === "system"
    ? (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark")
    : mode;
  document.documentElement.setAttribute("data-theme", resolved);
}

let msgIdCounter = 0;

@customElement("conductor-app")
export class ConductorApp extends LitElement {
  @state() tab: Tab = "main";
  @state() theme: ThemeMode = loadTheme();
  @state() connected = false;

  // Chat state
  @state() chatMessages: ChatMessage[] = [];
  @state() chatInput = "";

  // Plan state
  @state() plan: Plan | null = null;
  @state() planLoading = false;
  @state() planError: string | null = null;
  @state() expandedAgent: string | null = null;

  // Execution state
  @state() executionTurns: ExecutionTurn[] = [];
  @state() executionViewMode: "agent" | "round" | "step" = "agent";
  @state() executionExpandedAgent: string | null = null;
  @state() executionExpandedRound: number | null = null;
  @state() executionRunning = false;
  @state() executionStopped = false;
  @state() executionRunId: string | null = null;
  @state() executionError: string | null = null;
  @state() executionRound = 1;
  @state() executionTotalRounds = 1;

  // History state
  @state() runs: ExecutionRun[] = [];
  @state() runsLoading = false;

  private ws: WebSocket | null = null;
  private reconnectTimer: number | null = null;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    applyThemeToDocument(this.theme);
    this.connectWs();
    const saved = loadSession();
    if (saved.messages.length) {
      this.chatMessages = saved.messages;
      msgIdCounter = saved.messages.length;
    }
    if (saved.plan) {
      this.plan = saved.plan;
    }
    this.loadRuns();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.ws) this.ws.close();
    if (this.reconnectTimer != null) clearTimeout(this.reconnectTimer);
  }

  private connectWs() {
    this.ws = connectWebSocket((msg) => this.handleWsMessage(msg));
    this.ws.onopen = () => { this.connected = true; };
    this.ws.onclose = () => {
      this.connected = false;
      this.reconnectTimer = window.setTimeout(() => this.connectWs(), 3000);
    };
    this.ws.onerror = () => { this.connected = false; };
  }

  private handleWsMessage(msg: WsMessage) {
    switch (msg.type) {
      case "turn:start": {
        if (msg.turnIndex < this.executionTurns.length) {
          this.executionTurns = this.executionTurns.map((t, i) =>
            i === msg.turnIndex ? { ...t, status: "running" as const } : t
          );
        }
        break;
      }
      case "turn:done": {
        if (msg.turnIndex < this.executionTurns.length) {
          this.executionTurns = this.executionTurns.map((t, i) =>
            i === msg.turnIndex
              ? {
                  ...t,
                  status: msg.ok ? ("done" as const) : ("failed" as const),
                  result: { agentId: msg.agentId, ok: msg.ok, reply: msg.reply, durationMs: msg.durationMs },
                }
              : t
          );
        }
        break;
      }
      case "round:start": {
        this.executionRound = msg.round;
        this.executionTotalRounds = msg.totalRounds;
        break;
      }
      case "run:done": {
        this.executionRunning = false;
        this.executionStopped = msg.status === "stopped";
        break;
      }
      case "run:resumed": {
        this.executionRunning = true;
        this.executionStopped = false;
        break;
      }
      case "error": {
        this.executionError = msg.message;
        this.executionRunning = false;
        break;
      }
    }
  }

  toggleTheme() {
    const next = this.theme === "dark" ? "light" : "dark";
    this.theme = next;
    localStorage.setItem("conductor-theme", next);
    applyThemeToDocument(next);
  }

  setTab(tab: Tab) {
    this.tab = tab;
  }

  resetSession() {
    this.chatMessages = [];
    this.chatInput = "";
    this.plan = null;
    this.planError = null;
    this.expandedAgent = null;
    this.executionTurns = [];
    this.executionRunning = false;
    this.executionStopped = false;
    this.executionRunId = null;
    this.executionError = null;
    localStorage.removeItem(STORAGE_KEY);
    msgIdCounter = 0;
  }

  scrollChatToBottom() {
    requestAnimationFrame(() => {
      const el = document.getElementById("chat-messages");
      if (el) el.scrollTop = el.scrollHeight;
    });
  }

  async sendMessage() {
    const text = this.chatInput.trim();
    if (!text || this.planLoading) return;

    const userMsg: ChatMessage = {
      id: `msg-${++msgIdCounter}`,
      role: "user",
      content: text,
      timestamp: Date.now(),
    };

    this.chatMessages = [...this.chatMessages, userMsg];
    this.chatInput = "";
    this.planLoading = true;
    this.planError = null;
    this.scrollChatToBottom();

    try {
      const apiMessages = this.chatMessages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const result = await apiChat(apiMessages, this.plan);

      if (result.plan) {
        this.plan = result.plan;
      }

      const assistantMsg: ChatMessage = {
        id: `msg-${++msgIdCounter}`,
        role: "assistant",
        content: result.message,
        timestamp: Date.now(),
      };
      this.chatMessages = [...this.chatMessages, assistantMsg];
      saveSession(this.chatMessages, this.plan);
    } catch (err) {
      this.planError = err instanceof Error ? err.message : String(err);
      const errorMsg: ChatMessage = {
        id: `msg-${++msgIdCounter}`,
        role: "assistant",
        content: `Something went wrong: ${this.planError}`,
        timestamp: Date.now(),
      };
      this.chatMessages = [...this.chatMessages, errorMsg];
    } finally {
      this.planLoading = false;
      this.scrollChatToBottom();
    }
  }

  async stopExecution() {
    if (!this.executionRunId) return;
    try {
      await apiStopRun(this.executionRunId);
    } catch (err) {
      this.executionError = err instanceof Error ? err.message : String(err);
    }
  }

  async resumeExecution() {
    if (!this.executionRunId) return;
    try {
      this.executionError = null;
      await apiResumeRun(this.executionRunId);
      this.executionRunning = true;
      this.executionStopped = false;
    } catch (err) {
      this.executionError = err instanceof Error ? err.message : String(err);
    }
  }

  async executePlan() {
    if (!this.plan) return;
    this.executionRunning = true;
    this.executionStopped = false;
    this.executionError = null;
    this.executionRound = 1;
    this.executionTotalRounds = this.plan.rounds;

    const turns: ExecutionTurn[] = [];
    let idx = 0;
    for (let r = 1; r <= this.plan.rounds; r++) {
      for (const agent of this.plan.agents) {
        turns.push({
          round: r,
          agentId: agent.id,
          agentName: agent.name,
          index: idx++,
          status: "pending" as const,
        });
      }
    }
    this.executionTurns = turns;
    this.tab = "execution";

    try {
      const { runId } = await apiExecutePlan(this.plan);
      this.executionRunId = runId;
    } catch (err) {
      this.executionError = err instanceof Error ? err.message : String(err);
      this.executionRunning = false;
    }
  }

  async loadRuns() {
    this.runsLoading = true;
    try {
      const runs = await apiGetRuns();
      this.runs = runs.map((r) => ({
        ...r,
        status: r.status as "running" | "completed" | "failed" | "stopped",
      }));
    } catch {
      // silently fail
    } finally {
      this.runsLoading = false;
    }
  }

  render() {
    return html`
      <div class="shell">
        <header class="topbar">
          <div class="topbar-left">
            <div class="brand">
              <img class="brand-logo-img" src="/logo.png" alt="Logo" />
              <div class="brand-text">
                <div class="brand-title">MULTI-AGENT OPENCLAW</div>
                <div class="brand-sub">Multi-Agent Orchestrator</div>
              </div>
            </div>
          </div>
          <div class="topbar-status">
            <button
              class="btn btn--primary"
              @click=${() => this.resetSession()}
            >
              ${icons.plus} New Session
            </button>
            <div class="pill">
              <span class="statusDot ${this.connected ? "ok" : ""}"></span>
              <span>Server</span>
              <span class="mono">${this.connected ? "connected" : "offline"}</span>
            </div>
            <button
              class="theme-toggle"
              @click=${() => this.toggleTheme()}
              title="Toggle theme"
            >
              ${this.theme === "dark" ? icons.sun : icons.moon}
            </button>
          </div>
        </header>

        <aside class="nav">
          <div class="nav-group">
            ${NAV_ITEMS.map(
              (item) => html`
                <button
                  class="nav-item ${this.tab === item.tab ? "nav-item--active" : ""}"
                  @click=${() => this.setTab(item.tab)}
                >
                  <span class="nav-item__icon">${icons[item.icon]}</span>
                  <span>${item.label}</span>
                </button>
              `
            )}
          </div>
        </aside>

        <main class="content">
          ${this.tab === "main"
            ? html`
                <div class="split-pane">
                  ${renderChat(this)}
                  ${renderPlanPanel(this)}
                </div>
              `
            : nothing}
          ${this.tab === "execution"
            ? html`
                <div class="content-padded">
                  <section class="content-header">
                    <div>
                      <div class="page-title">Live Execution</div>
                      <div class="page-sub">Monitor real-time agent turns</div>
                    </div>
                  </section>
                  ${renderExecution(this)}
                </div>
              `
            : nothing}
          ${this.tab === "history"
            ? html`
                <div class="content-padded">
                  <section class="content-header">
                    <div>
                      <div class="page-title">History</div>
                      <div class="page-sub">Browse past execution runs</div>
                    </div>
                  </section>
                  ${renderHistory(this)}
                </div>
              `
            : nothing}
        </main>
      </div>
    `;
  }
}
