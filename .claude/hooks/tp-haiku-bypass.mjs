#!/usr/bin/env node
/**
 * Gate in front of token-pilot hooks.
 *
 * Policy (MedTrust): Haiku is cheap — do NOT apply read/bash/context
 * optimisations inside Haiku (or default-haiku) subagents. Keep enforcement
 * for the main session and for agents whose frontmatter pins sonnet/opus.
 *
 * Usage: node tp-haiku-bypass.mjs <hook-name> [-- <node> <tp-index.js> ...]
 * If -- is omitted, resolves token-pilot via NODE_PATH / require.
 */
import { spawn } from "node:child_process";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const dash = args.indexOf("--");
const hookName = dash === -1 ? args[0] : args[0];
const forward = dash === -1 ? [] : args.slice(dash + 1);

if (!hookName) {
  process.stderr.write("[tp-haiku-bypass] missing hook name\n");
  process.exit(0); // fail open
}

const stdin = readFileSync(0, "utf8");
let input = {};
try {
  input = JSON.parse(stdin || "{}");
} catch {
  input = {};
}

function projectRoot() {
  const fromEnv =
    process.env.CLAUDE_PROJECT_DIR ||
    process.env.CLAUDE_CODE_PROJECT_DIR ||
    "";
  if (fromEnv && existsSync(join(fromEnv, ".claude"))) return fromEnv;
  // walk up from cwd
  let cur = process.cwd();
  for (let i = 0; i < 12; i++) {
    if (existsSync(join(cur, ".claude", "agents"))) return cur;
    if (existsSync(join(cur, ".token-pilot.json"))) return cur;
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  // fallback: this file lives in <root>/.claude/hooks
  return dirname(dirname(__dirname));
}

function loadAgentModels(root) {
  const haiku = new Set();
  const costly = new Set();
  const dir = join(root, ".claude", "agents");
  if (!existsSync(dir)) return { haiku, costly };
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".md")) continue;
    const text = readFileSync(join(dir, f), "utf8");
    const name = text.match(/^name:\s*(.+)$/m)?.[1]?.trim();
    const model = text.match(/^model:\s*(.+)$/m)?.[1]?.trim()?.toLowerCase() ?? "";
    if (!name) continue;
    if (model.includes("haiku")) haiku.add(name);
    else if (model.includes("sonnet") || model.includes("opus")) costly.add(name);
  }
  return { haiku, costly };
}

/** Hooks that only ever run in the main session — never bypass. */
const MAIN_ONLY = new Set([
  "hook-bootstrap",
  "hook-session-start",
  "hook-user-prompt",
  "hook-pre-task",
]);

function shouldBypass(input, hookName, maps) {
  if (MAIN_ONLY.has(hookName)) return false;

  const agentType = typeof input.agent_type === "string" ? input.agent_type : "";
  const agentId = input.agent_id;
  const inSubagent = Boolean(agentId) || Boolean(agentType);
  if (!inSubagent) return false; // main session keeps optimisations

  // Explicit costly (sonnet/opus) agents keep token-pilot
  if (agentType && maps.costly.has(agentType)) return false;

  // Explicit haiku agents: bypass
  if (agentType && maps.haiku.has(agentType)) return true;

  // Unknown / general-purpose / Plan / etc.
  // Project sets CLAUDE_CODE_SUBAGENT_MODEL=haiku without FORCE, so defaults are haiku.
  return true;
}

const root = projectRoot();
const maps = loadAgentModels(root);

if (shouldBypass(input, hookName, maps)) {
  // Pass-through: allow the tool call with no token-pilot intervention.
  process.exit(0);
}

function resolveTpIndex() {
  if (forward.length >= 2) return { node: forward[0], script: forward[1], rest: forward.slice(2) };
  // Try createRequire from this file, then common npx cache
  try {
    const req = createRequire(join(root, "package.json"));
    const script = req.resolve("token-pilot/dist/index.js");
    return { node: process.execPath, script, rest: [] };
  } catch {
    /* continue */
  }
  const candidates = [
    join(process.env.HOME || "", ".npm/_npx/3c6ec659f659d129/node_modules/token-pilot/dist/index.js"),
  ];
  for (const script of candidates) {
    if (existsSync(script)) return { node: process.execPath, script, rest: [] };
  }
  process.stderr.write("[tp-haiku-bypass] token-pilot not found; fail-open\n");
  process.exit(0);
}

const { node, script, rest } = resolveTpIndex();
const child = spawn(node, [script, hookName, ...rest], {
  stdio: ["pipe", "inherit", "inherit"],
  env: process.env,
});
child.stdin.write(stdin);
child.stdin.end();
child.on("exit", (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code ?? 0);
});
child.on("error", (err) => {
  process.stderr.write(`[tp-haiku-bypass] spawn error: ${err.message}; fail-open\n`);
  process.exit(0);
});
