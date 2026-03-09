import { html, nothing } from "lit";
import { icons } from "../icons.ts";
import type { ConductorApp } from "../app.ts";

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString();
}

function formatDuration(start: number, end?: number): string {
  const ms = (end ?? Date.now()) - start;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

export function renderHistory(app: ConductorApp) {
  return html`
    <div style="display: flex; flex-direction: column; gap: 14px;">
      <div style="display: flex; justify-content: flex-end;">
        <button class="btn btn--sm" @click=${() => app.loadRuns()} ?disabled=${app.runsLoading}>
          ${app.runsLoading ? html`<span class="spinner spinner--sm"></span>` : icons.refresh}
          Refresh
        </button>
      </div>

      ${app.runs.length === 0
        ? html`
            <div class="empty-state">
              <div class="empty-state__icon">${icons.history}</div>
              <div class="empty-state__text">
                ${app.runsLoading ? "Loading runs..." : "No execution runs yet."}
              </div>
              ${!app.runsLoading
                ? html`<button class="btn" @click=${() => app.loadRuns()}>Load Runs</button>`
                : nothing}
            </div>
          `
        : html`
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Status</th>
                    <th>Goal</th>
                    <th>Turns</th>
                    <th>Started</th>
                    <th>Duration</th>
                  </tr>
                </thead>
                <tbody>
                  ${app.runs.map((run) => {
                    const doneCount = run.turns.filter((t) => t.status === "done").length;
                    const failedCount = run.turns.filter((t) => t.status === "failed").length;
                    return html`
                      <tr>
                        <td>
                          <span class="statusDot ${run.status === "completed" ? "ok" : run.status === "running" ? "running" : run.status === "stopped" ? "warn" : "danger"}"></span>
                          ${run.status}
                        </td>
                        <td style="max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${run.goal}</td>
                        <td>
                          <span style="color: var(--ok);">${doneCount}</span>
                          ${failedCount > 0 ? html`/ <span style="color: var(--danger);">${failedCount}</span>` : nothing}
                          / ${run.turns.length}
                        </td>
                        <td style="font-family: var(--mono); font-size: 11px;">${formatTime(run.startedAt)}</td>
                        <td style="font-family: var(--mono); font-size: 11px;">${formatDuration(run.startedAt, run.finishedAt)}</td>
                      </tr>
                    `;
                  })}
                </tbody>
              </table>
            </div>
          `}
    </div>
  `;
}
