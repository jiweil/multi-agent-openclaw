import { html, nothing } from "lit";
import { icons } from "../icons.ts";
import type { ConductorApp } from "../app.ts";
import type { ExecutionTurn } from "../types.ts";

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function renderTurnCard(turn: ExecutionTurn, showAgent = true, showRound = true) {
  return html`
    <div class="step-card step-card--${turn.status}">
      <div class="step-number">
        ${turn.status === "done"
          ? icons.check
          : turn.status === "failed"
            ? icons.x
            : turn.status === "running"
              ? html`<span class="spinner spinner--sm"></span>`
              : turn.index + 1}
      </div>
      <div class="step-body">
        <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
          ${showAgent
            ? html`<div class="step-agent">${turn.agentName}</div>`
            : nothing}
          ${showRound
            ? html`<span style="font-size: 9px; font-family: var(--mono); color: var(--accent); background: var(--accent-subtle); padding: 1px 6px; border-radius: 99px;">R${turn.round}</span>`
            : nothing}
        </div>
        ${turn.result
          ? html`
              <div class="step-duration">
                ${turn.result.ok ? "completed" : "failed"} in ${formatDuration(turn.result.durationMs)}
              </div>
              ${turn.result.reply
                ? html`<div class="step-result">${turn.result.reply}</div>`
                : nothing}
            `
          : nothing}
      </div>
    </div>
  `;
}

/* ── By Agent view ── */
function renderByAgent(app: ConductorApp) {
  const agentMap = new Map<string, ExecutionTurn[]>();
  for (const turn of app.executionTurns) {
    const list = agentMap.get(turn.agentId) ?? [];
    list.push(turn);
    agentMap.set(turn.agentId, list);
  }

  return html`
    <div class="exec-agent-list">
      ${[...agentMap.entries()].map(([agentId, turns]) => {
        const expanded = app.executionExpandedAgent === agentId;
        const doneCount = turns.filter((t) => t.status === "done").length;
        const failedCount = turns.filter((t) => t.status === "failed").length;
        const runningCount = turns.filter((t) => t.status === "running").length;
        const displayName = turns[0]?.agentName ?? agentId;

        let statusIcon = html`<span style="color: var(--muted);">${icons.history}</span>`;
        if (failedCount > 0) statusIcon = html`<span style="color: var(--danger);">${icons.x}</span>`;
        else if (doneCount === turns.length) statusIcon = html`<span style="color: var(--ok);">${icons.check}</span>`;
        else if (runningCount > 0) statusIcon = html`<span class="spinner spinner--sm"></span>`;

        return html`
          <div class="exec-agent-card">
            <button
              class="exec-agent-header"
              @click=${() => { app.executionExpandedAgent = expanded ? null : agentId; }}
            >
              <div style="display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0;">
                ${statusIcon}
                <span class="exec-agent-name">${displayName}</span>
                <span class="exec-agent-badge">${doneCount}/${turns.length} rounds</span>
              </div>
              <span class="exec-agent-chevron ${expanded ? "exec-agent-chevron--open" : ""}">▸</span>
            </button>
            ${expanded
              ? html`<div class="exec-agent-body">${turns.map((t) => renderTurnCard(t, false, true))}</div>`
              : nothing}
          </div>
        `;
      })}
    </div>
  `;
}

/* ── By Round view ── */
function renderByRound(app: ConductorApp) {
  const roundMap = new Map<number, ExecutionTurn[]>();
  for (const turn of app.executionTurns) {
    const list = roundMap.get(turn.round) ?? [];
    list.push(turn);
    roundMap.set(turn.round, list);
  }
  const rounds = [...roundMap.entries()].sort(([a], [b]) => a - b);

  return html`
    <div class="exec-agent-list">
      ${rounds.map(([roundNum, turns]) => {
        const expanded = app.executionExpandedRound === roundNum;
        const doneCount = turns.filter((t) => t.status === "done").length;
        const failedCount = turns.filter((t) => t.status === "failed").length;
        const runningCount = turns.filter((t) => t.status === "running").length;

        let statusIcon = html`<span style="color: var(--muted);">${icons.history}</span>`;
        if (failedCount > 0) statusIcon = html`<span style="color: var(--danger);">${icons.x}</span>`;
        else if (doneCount === turns.length) statusIcon = html`<span style="color: var(--ok);">${icons.check}</span>`;
        else if (runningCount > 0) statusIcon = html`<span class="spinner spinner--sm"></span>`;

        return html`
          <div class="exec-agent-card">
            <button
              class="exec-agent-header"
              @click=${() => { app.executionExpandedRound = expanded ? null : roundNum; }}
            >
              <div style="display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0;">
                ${statusIcon}
                <span class="exec-agent-name">Round ${roundNum}</span>
                <span class="exec-agent-badge">${doneCount}/${turns.length} agents</span>
              </div>
              <span class="exec-agent-chevron ${expanded ? "exec-agent-chevron--open" : ""}">▸</span>
            </button>
            ${expanded
              ? html`<div class="exec-agent-body">${turns.map((t) => renderTurnCard(t, true, false))}</div>`
              : nothing}
          </div>
        `;
      })}
    </div>
  `;
}

/* ── By Step (flat) view ── */
function renderByStep(app: ConductorApp) {
  return html`
    <div class="wave-steps">
      ${app.executionTurns.map((turn) => renderTurnCard(turn, true, true))}
    </div>
  `;
}

/* ── Main render ── */
export function renderExecution(app: ConductorApp) {
  if (app.executionTurns.length === 0) {
    return html`
      <div class="empty-state">
        <div class="empty-state__icon">${icons.play}</div>
        <div class="empty-state__text">
          No execution in progress. Generate and execute a plan first.
        </div>
        <button class="btn" @click=${() => app.setTab("main")}>
          Go to Planner
        </button>
      </div>
    `;
  }

  const total = app.executionTurns.length;
  const done = app.executionTurns.filter((t) => t.status === "done").length;
  const failed = app.executionTurns.filter((t) => t.status === "failed").length;
  const running = app.executionTurns.filter((t) => t.status === "running").length;
  const pending = app.executionTurns.filter((t) => t.status === "pending").length;
  const progressPct = total > 0 ? ((done + failed) / total) * 100 : 0;
  const allOk = done === total;
  const totalRounds = new Set(app.executionTurns.map((t) => t.round)).size;

  return html`
    <div style="display: flex; flex-direction: column; gap: 16px;">
      ${app.executionError
        ? html`<div class="alert alert--danger">${app.executionError}</div>`
        : nothing}

      <div class="stats-row">
        <div class="stat-card">
          <div class="stat-value" style="color: var(--ok);">${done}</div>
          <div class="stat-label">Completed</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" style="color: var(--info);">${running}</div>
          <div class="stat-label">Running</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" style="color: var(--muted);">${pending}</div>
          <div class="stat-label">Pending</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" style="color: var(--danger);">${failed}</div>
          <div class="stat-label">Failed</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${totalRounds}</div>
          <div class="stat-label">Rounds</div>
        </div>
      </div>

      <div>
        <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
          <span style="font-size: 11px; color: var(--muted);">
            ${app.executionRunning ? "Executing..." : app.executionStopped ? `Stopped — ${done}/${total} completed` : allOk ? "All turns completed" : `Finished — ${done}/${total} succeeded`}
          </span>
          <span style="font-size: 11px; font-family: var(--mono); color: var(--muted);">${Math.round(progressPct)}%</span>
        </div>
        <div class="progress-bar">
          <div
            class="progress-bar__fill ${allOk && !app.executionRunning ? "progress-bar__fill--ok" : ""}"
            style="width: ${progressPct}%"
          ></div>
        </div>
      </div>

      <!-- View mode toggle -->
      <div class="exec-view-toggle">
        <button
          class="exec-view-btn ${app.executionViewMode === "agent" ? "exec-view-btn--active" : ""}"
          @click=${() => { app.executionViewMode = "agent"; }}
        >
          ${icons.users} By Agent
        </button>
        <button
          class="exec-view-btn ${app.executionViewMode === "round" ? "exec-view-btn--active" : ""}"
          @click=${() => { app.executionViewMode = "round"; }}
        >
          ${icons.refresh} By Round
        </button>
        <button
          class="exec-view-btn ${app.executionViewMode === "step" ? "exec-view-btn--active" : ""}"
          @click=${() => { app.executionViewMode = "step"; }}
        >
          ${icons.plan} All Turns
        </button>
      </div>

      ${app.executionViewMode === "agent"
        ? renderByAgent(app)
        : app.executionViewMode === "round"
          ? renderByRound(app)
          : renderByStep(app)}

      ${app.executionRunning
        ? html`
            <div style="display: flex; gap: 10px; justify-content: flex-end; padding-top: 6px;">
              <button class="btn btn--danger" @click=${() => app.stopExecution()}>
                ${icons.stop} Stop
              </button>
            </div>
          `
        : app.executionTurns.length > 0
          ? html`
              <div style="display: flex; gap: 10px; justify-content: flex-end; padding-top: 6px;">
                <button class="btn" @click=${() => app.setTab("main")}>
                  ${icons.chat} Back to Planner
                </button>
                ${app.executionStopped
                  ? html`
                      <button class="btn btn--primary" @click=${() => app.resumeExecution()}>
                        ${icons.resume} Resume
                      </button>
                    `
                  : nothing}
                <button class="btn btn--primary" @click=${() => app.executePlan()}>
                  ${icons.refresh} Re-run
                </button>
              </div>
            `
          : nothing}
    </div>
  `;
}
