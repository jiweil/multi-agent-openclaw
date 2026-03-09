import { html, nothing } from "lit";
import { icons } from "../icons.ts";
import type { ConductorApp } from "../app.ts";

export function renderPlanPanel(app: ConductorApp) {
  if (!app.plan && !app.planLoading) {
    return html`
      <div class="plan-panel">
        <div class="plan-empty">
          <div class="empty-state__icon">${icons.plan}</div>
          <div class="empty-state__text">
            Your execution plan will appear here<br />as you describe the scenario.
          </div>
        </div>
      </div>
    `;
  }

  if (!app.plan && app.planLoading) {
    return html`
      <div class="plan-panel">
        <div class="plan-loading-full">
          <span class="spinner"></span>
          <div style="margin-top: 12px; color: var(--muted); font-size: 13px;">Generating plan...</div>
        </div>
      </div>
    `;
  }

  if (!app.plan) return nothing;

  return html`
    <div class="plan-panel">
      <div class="plan-content ${app.planLoading ? "plan-content--updating" : ""}">
        ${app.planLoading
          ? html`
              <div class="plan-updating-banner">
                <span class="spinner spinner--sm"></span>
                Updating plan...
              </div>
            `
          : nothing}

        <!-- Goal -->
        <div class="plan-goal">
          <span style="flex-shrink: 0; color: var(--accent);">${icons.target}</span>
          <span>${app.plan.goal}</span>
        </div>

        <!-- Stats -->
        <div class="plan-stats">
          <div class="plan-stat">
            <div class="plan-stat-value">${app.plan.agents.length}</div>
            <div class="plan-stat-label">Agents</div>
          </div>
          <div class="plan-stat">
            <div class="plan-stat-value">${app.plan.rounds}</div>
            <div class="plan-stat-label">Round${app.plan.rounds > 1 ? "s" : ""}</div>
          </div>
        </div>

        <!-- Agent list -->
        <div class="plan-section">
          <div class="plan-section-title">${icons.users} Agents</div>
          <div class="agent-accordion">
            ${app.plan.agents.map((agent) => {
              const isExpanded = app.expandedAgent === agent.id;

              return html`
                <div class="agent-item ${isExpanded ? "agent-item--expanded" : ""}">
                  <button
                    class="agent-item-header"
                    @click=${() => {
                      app.expandedAgent = isExpanded ? null : agent.id;
                    }}
                  >
                    <span class="plan-agent-avatar">${agent.name[0].toUpperCase()}</span>
                    <div class="agent-item-info">
                      <div class="agent-item-name">${agent.name}</div>
                      <div class="agent-item-role">${agent.role}</div>
                    </div>
                    <span class="agent-item-chevron ${isExpanded ? "agent-item-chevron--open" : ""}">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                    </span>
                  </button>

                  ${isExpanded
                    ? html`
                        <div class="agent-item-steps">
                          <div class="agent-goal-card">
                            <div class="agent-goal-label">Goal</div>
                            <div class="agent-goal-text">${agent.goal}</div>
                          </div>
                        </div>
                      `
                    : nothing}
                </div>
              `;
            })}
          </div>
        </div>

        <!-- Execute button -->
        <div style="padding-top: 8px; display: flex; justify-content: flex-end;">
          <button
            class="btn btn--primary"
            @click=${() => app.executePlan()}
            ?disabled=${app.executionRunning || app.planLoading}
            style="padding: 8px 20px;"
          >
            ${icons.play} Execute Plan
          </button>
        </div>
      </div>
    </div>
  `;
}
