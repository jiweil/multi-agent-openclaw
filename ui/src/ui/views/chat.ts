import { html, nothing } from "lit";
import { icons } from "../icons.ts";
import type { ConductorApp } from "../app.ts";

const EXAMPLE_GOAL = `A founder pitches their AI startup to 3 rival VCs. One is a true believer who wants to lead the round, one is a ruthless skeptic trying to kill the deal so nobody invests, and one is a cutthroat who wants to steal the deal at a lower valuation. The VCs trash-talk each other's investment theses while fighting over (or against) the founder. Everything stops after 5 rounds.`;

export function renderChat(app: ConductorApp) {
  const canSend = app.chatInput.trim().length > 0 && !app.planLoading;

  const handleKeydown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (canSend) app.sendMessage();
    }
    if (e.key === "Tab" && !app.chatInput.trim()) {
      e.preventDefault();
      app.chatInput = EXAMPLE_GOAL;
    }
  };

  const isFirstTurn = app.chatMessages.length === 0;

  return html`
    <div class="chat-panel">
      <div class="chat-messages" id="chat-messages">
        ${isFirstTurn
          ? html`
              <div class="chat-welcome">
                <div class="chat-welcome-icon">${icons.chat}</div>
                <div class="chat-welcome-title">Multi-Agent OpenClaw</div>
                <div class="chat-welcome-text">
                  Describe the scenario you want your agents to act out.
                  I'll create an execution plan you can refine through conversation.
                </div>
              </div>
            `
          : html`
              <div class="chat-msg-list">
                ${app.chatMessages.map(
                  (msg) => html`
                    <div class="chat-msg chat-msg--${msg.role}">
                      <div class="chat-msg-bubble">${msg.content}</div>
                    </div>
                  `
                )}
                ${app.planLoading
                  ? html`
                      <div class="chat-msg chat-msg--assistant">
                        <div class="chat-msg-bubble chat-msg-thinking">
                          <span class="spinner spinner--sm"></span>
                          Thinking...
                        </div>
                      </div>
                    `
                  : nothing}
              </div>
            `}
      </div>

      <div class="chat-input-area ${isFirstTurn ? "chat-input-area--first" : ""}">
        <div class="chat-input-wrap ${isFirstTurn ? "chat-input-wrap--first" : ""}">
          <textarea
            class="chat-input ${isFirstTurn ? "chat-input--first" : ""}"
            rows="${isFirstTurn ? 6 : 1}"
            placeholder="${isFirstTurn
              ? "Describe your scenario here...\n\ne.g. A founder pitches their AI startup to 3 rival VCs.\nOne wants to lead the round, one tries to kill the deal,\nand one wants to steal it at a lower valuation.\nThey trash-talk each other while fighting over the founder.\nEverything stops after 5 rounds."
              : "Refine the plan..."}"
            .value=${app.chatInput}
            @input=${(e: Event) => {
              app.chatInput = (e.target as HTMLTextAreaElement).value;
              if (!isFirstTurn) {
                const ta = e.target as HTMLTextAreaElement;
                ta.style.height = "auto";
                ta.style.height = Math.min(ta.scrollHeight, 120) + "px";
              }
            }}
            @keydown=${handleKeydown}
            ?disabled=${app.planLoading}
          ></textarea>
          <button
            class="chat-send-btn ${isFirstTurn ? "chat-send-btn--first" : ""}"
            @click=${() => app.sendMessage()}
            ?disabled=${!canSend}
            title="Send (Enter)"
          >
            ${icons.send}
          </button>
        </div>
        <div class="chat-input-hint">
          <strong>Enter</strong> send &middot; <strong>Shift+Enter</strong> new line${isFirstTurn ? html` &middot; <strong>Tab</strong> example` : nothing}
        </div>
      </div>
    </div>
  `;
}
