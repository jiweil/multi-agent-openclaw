import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const HISTORY_DIR = resolve(__dirname, "..", "history");

function ensureDir() {
  if (!existsSync(HISTORY_DIR)) {
    mkdirSync(HISTORY_DIR, { recursive: true });
  }
}

export function saveRun(run: Record<string, unknown>): void {
  ensureDir();
  const id = String(run.id ?? `run-${Date.now()}`);
  const filePath = join(HISTORY_DIR, `${id}.json`);
  writeFileSync(filePath, JSON.stringify(run, null, 2));
}

export function loadAllRuns(): Array<Record<string, unknown>> {
  ensureDir();
  const files = readdirSync(HISTORY_DIR).filter((f) => f.endsWith(".json"));
  const runs: Array<Record<string, unknown>> = [];
  for (const file of files) {
    try {
      const raw = readFileSync(join(HISTORY_DIR, file), "utf-8");
      runs.push(JSON.parse(raw));
    } catch {
      // skip corrupted files
    }
  }
  runs.sort((a, b) => (Number(b.startedAt) || 0) - (Number(a.startedAt) || 0));
  return runs;
}
