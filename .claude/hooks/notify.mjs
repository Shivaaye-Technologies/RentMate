#!/usr/bin/env node
// Notification / Stop hook: records when Claude finishes or needs input, and
// rings the terminal bell. Extend with a desktop or push notifier if wanted.
import { log, readPayload } from "./lib.mjs";

const payload = await readPayload();
const event = payload?.hook_event_name ?? "event";
const message = payload?.message ?? (event === "Stop" ? "Task finished" : "Needs your input");

log("session", `${event}: ${String(message).slice(0, 200)}`);
process.stderr.write("\u0007");
process.exit(0);
