// Shared helpers for Claude Code hooks. Hooks receive a JSON payload on stdin.
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const projectDir =
  process.env.CLAUDE_PROJECT_DIR || join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export async function readPayload() {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return {};
  }
}

/** Appends one line to .claude/logs/<name>.log. Never logs secrets: callers pass summaries only. */
export function log(name, message) {
  try {
    const dir = join(projectDir, ".claude", "logs");
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, `${name}.log`), `${new Date().toISOString()} ${message}\n`);
  } catch {
    // Logging must never break a hook.
  }
}

/** Exit code 2 blocks the tool call and shows the reason to Claude. */
export function block(reason) {
  log("blocked", reason);
  process.stderr.write(`BLOCKED by project hook: ${reason}\n`);
  process.exit(2);
}
