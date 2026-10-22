#!/usr/bin/env node
// PreToolUse hook for Read/Edit/Write/MultiEdit:
// - never read or write real .env files (.env.example is fine)
// - applied migrations are append-only: edit by adding a NEW migration file
import { existsSync } from "node:fs";
import { basename, isAbsolute, join, relative } from "node:path";
import { block, projectDir, readPayload } from "./lib.mjs";

const payload = await readPayload();
const tool = payload?.tool_name ?? "";
const filePath = String(payload?.tool_input?.file_path ?? "");
if (!filePath) process.exit(0);

const abs = isAbsolute(filePath) ? filePath : join(projectDir, filePath);
const rel = relative(projectDir, abs).split("\\").join("/");
const name = basename(abs);

if (/^\.env(\..+)?$/.test(name) && name !== ".env.example") {
  block(
    `${tool} on ${name} is not allowed. Secrets stay out of Claude's context; edit .env.example instead.`,
  );
}

if (
  (tool === "Edit" || tool === "MultiEdit" || tool === "Write") &&
  rel.startsWith("supabase/migrations/") &&
  existsSync(abs)
) {
  block(
    `${rel} is an existing migration and may already be applied. Create a new timestamped migration instead.`,
  );
}

process.exit(0);
