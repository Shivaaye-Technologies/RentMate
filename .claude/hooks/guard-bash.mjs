#!/usr/bin/env node
// PreToolUse hook for Bash: blocks destructive or prohibited commands.
// Exit 0 = allow, exit 2 = block (stderr is shown to Claude).
import { block, log, readPayload } from "./lib.mjs";

const RULES = [
  [
    /\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)[a-z]*\s+(\/|~|\$HOME|\.\.?)(\s|\/?$)/i,
    "recursive delete of root, home, or project directory",
  ],
  [/\bgit\s+push\b.*(\s--force\b|\s-f\b|\s--force-with-lease\b)/i, "force push"],
  [
    /\bgit\s+push\b.*\b(main|master|production)\b/i,
    "direct push to a protected branch (open a pull request instead)",
  ],
  [/\bgit\s+reset\s+--hard\b/i, "git reset --hard discards work"],
  [/\bgit\s+clean\s+-[a-z]*f/i, "git clean -f deletes untracked files"],
  [
    /\b(drop\s+(table|database|schema)|truncate\s+(table\s+)?\w)/i,
    "destructive SQL (DROP/TRUNCATE) needs human approval",
  ],
  [/\bdelete\s+from\s+\w+(\s*;|\s*$)/i, "DELETE without a WHERE clause"],
  [
    /\bsupabase\s+db\s+(reset|push)\b/i,
    "supabase db reset/push changes a database; run it yourself after review",
  ],
  [/\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(ba|z)?sh\b/i, "piping a downloaded script into a shell"],
  [
    /(^|[\s;&|])(cat|less|more|head|tail|type|bat)\s+[^|;&]*\.env(\s|$)(?!.*example)/i,
    "reading .env (secrets)",
  ],
  [/\b(printenv|env)\s*($|\|)/i, "dumping all environment variables can leak secrets"],
  [/\bnpm\s+publish\b/i, "publishing a package"],
  [/\bchmod\s+-R\s+777\b/i, "world-writable permissions"],
];

const payload = await readPayload();
const command = String(payload?.tool_input?.command ?? "");

for (const [pattern, reason] of RULES) {
  if (pattern.test(command)) block(`${reason}. Command: ${command.slice(0, 200)}`);
}

log("commands", command.replace(/\s+/g, " ").slice(0, 300));
process.exit(0);
