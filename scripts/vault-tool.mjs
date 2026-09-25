#!/usr/bin/env node
/**
 * Shell-invokable vault tool runner for the Smart Notes companion.
 * Proxies to POST /api/agent/vault so agents can mutate the vault without
 * filesystem delete (blocked outside the sandbox) or raw markdown tricks.
 *
 * Usage:
 *   node scripts/vault-tool.mjs page_delete --path "Notebook/Section/note.md"
 *   node scripts/vault-tool.mjs page_write --path "..." --body "..."
 *   node scripts/vault-tool.mjs page_render --path "Notebook/Section/note.md"
 *   node scripts/vault-tool.mjs rr --path "Notebook/Section/note.md"
 *   node scripts/vault-tool.mjs ur --path "Notebook/Section/design.html" --viewport desktop
 *   PORT=53271 node scripts/vault-tool.mjs ur --path "+id/design.html" --viewport desktop
 *   node scripts/vault-tool.mjs --json '{"tool":"page_delete","args":{"path":"..."}}'
 *   node scripts/vault-tool.mjs --json-file payload.json
 *   node scripts/vault-tool.mjs page_write --path "..." --body-file body.html
 */

import fs from "node:fs";
import path from "node:path";

const TOOL_ALIASES = {
  rr: "page_render",
  ur: "ui_render",
};

function resolveDefaultPort() {
  const fromEnv = process.env.PORT || process.env.SMART_NOTES_PORT;
  if (fromEnv && String(fromEnv).trim()) return String(fromEnv).trim();
  // Prefer the live server's bound listen port when vault-tool runs as a child of Smart Notes.
  const bound = globalThis._smartNotesListenPort;
  if (Number.isFinite(bound) && bound > 0) return String(bound);
  return "3002";
}

const DEFAULT_PORT = resolveDefaultPort();
const DEFAULT_HOST = process.env.SMART_NOTES_HOST || "localhost";

function parseFlagArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    index += 1;
  }
  if (typeof args["body-file"] === "string" && args["body-file"]) {
    const bodyPath = path.resolve(String(args["body-file"]));
    args.body = fs.readFileSync(bodyPath, "utf8");
    delete args["body-file"];
  }
  return args;
}

function parseJsonPayload(raw, label) {
  const payload = JSON.parse(raw);
  if (!payload.tool || typeof payload.tool !== "string") {
    throw new Error(`${label} must include a string tool name.`);
  }
  return {
    tool: payload.tool,
    args: payload.args && typeof payload.args === "object" ? payload.args : {},
  };
}

function parseInvocation(argv) {
  if (argv.length === 0) {
    throw new Error(
      "Usage: node scripts/vault-tool.mjs <tool> [--key value ...] | --json '{...}' | --json-file path.json"
    );
  }

  if (argv[0] === "--json") {
    const raw = argv[1];
    if (!raw) throw new Error("--json requires a payload string.");
    return parseJsonPayload(raw, "JSON payload");
  }

  if (argv[0] === "--json-file") {
    const filePath = argv[1];
    if (!filePath) throw new Error("--json-file requires a path.");
    const raw = fs.readFileSync(path.resolve(filePath), "utf8");
    return parseJsonPayload(raw, "--json-file");
  }

  const [tool, ...rest] = argv;
  const resolvedTool = TOOL_ALIASES[tool] ?? tool;
  return { tool: resolvedTool, args: parseFlagArgs(rest) };
}

async function main() {
  const { tool, args } = parseInvocation(process.argv.slice(2));
  const port = Number.parseInt(String(DEFAULT_PORT), 10);
  const url = `http://${DEFAULT_HOST}:${port}/api/agent/vault`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tool, args }),
  });

  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = { raw: text };
  }

  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  if (!response.ok || payload.ok === false) {
    process.exit(1);
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
