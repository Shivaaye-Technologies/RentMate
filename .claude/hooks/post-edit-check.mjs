#!/usr/bin/env node
// PostToolUse hook for Edit/Write/MultiEdit: formats the changed file with
// Prettier, then lints it with ESLint. Lint errors exit 2 so Claude sees them
// and fixes them before moving on.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { extname, isAbsolute, join, relative } from "node:path";
import { log, projectDir, readPayload } from "./lib.mjs";

const payload = await readPayload();
const filePath = String(payload?.tool_input?.file_path ?? "");
if (!filePath) process.exit(0);

const abs = isAbsolute(filePath) ? filePath : join(projectDir, filePath);
const rel = relative(projectDir, abs);
if (!existsSync(abs) || rel.startsWith("..") || rel.includes("node_modules")) process.exit(0);

const ext = extname(abs).toLowerCase();
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const run = (args) =>
  spawnSync(npx, ["--no-install", ...args], {
    cwd: projectDir,
    encoding: "utf8",
    shell: process.platform === "win32",
  });

if ([".ts", ".tsx", ".js", ".mjs", ".json", ".md", ".css", ".html", ".yml", ".yaml"].includes(ext)) {
  const fmt = run(["prettier", "--write", "--log-level", "warn", rel]);
  log("hooks", `prettier ${rel} exit=${fmt.status}`);
}

if ([".ts", ".tsx", ".js", ".mjs"].includes(ext) && !rel.startsWith(".claude")) {
  const lint = run(["eslint", "--no-warn-ignored", rel]);
  log("hooks", `eslint ${rel} exit=${lint.status}`);
  if (lint.status === 1) {
    process.stderr.write(`ESLint found problems in ${rel}. Fix them:\n${lint.stdout}${lint.stderr}`);
    process.exit(2);
  }
}

process.exit(0);
