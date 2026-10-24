#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const repoPath = path.resolve(path.dirname(__filename), "..", "..");
const registryDir = path.join(repoPath, ".av", "work-item-guards");
const DEFAULT_BRANCH_NAMES = new Set(["main", "master"]);
const GUARD_STALE_AFTER_MS = 14400000;

function normalizeFsPath(value) {
  return String(value || "").trim().replace(/[\\/]+$/, "").replace(/\//g, "\\").toLowerCase();
}

function defaultBranchNames(mergeTarget) {
  const names = new Set(DEFAULT_BRANCH_NAMES);
  const normalized = String(mergeTarget || "").trim().toLowerCase();
  if (normalized) names.add(normalized);
  return names;
}

function classifyGuard(guard, now = Date.now()) {
  if (!guard || typeof guard !== "object") return { live: false };
  const workItemId = String(guard.workItemId || "").trim();
  if (!workItemId) return { live: false };
  const worktreePath = String(guard.worktreePath || "").trim();
  if (!worktreePath) return { live: false };
  try {
    if (!fs.existsSync(worktreePath)) return { live: false };
  } catch {
    return { live: false };
  }
  const heartbeatRaw = String(guard.lastHeartbeatAt || guard.installedAt || "").trim();
  const heartbeatMs = Date.parse(heartbeatRaw);
  if (!Number.isFinite(heartbeatMs)) return { live: false };
  if (now - heartbeatMs > GUARD_STALE_AFTER_MS) return { live: false };
  return { live: true };
}

function readActiveGuards() {
  if (!fs.existsSync(registryDir)) return [];
  const live = [];
  for (const entry of fs.readdirSync(registryDir)) {
    if (!entry.endsWith(".json")) continue;
    let guard = null;
    try {
      guard = JSON.parse(fs.readFileSync(path.join(registryDir, entry), "utf8"));
    } catch {
      continue;
    }
    if (!classifyGuard(guard).live) {
      try { fs.unlinkSync(path.join(registryDir, entry)); } catch { /* ignore */ }
      continue;
    }
    live.push(guard);
  }
  return live;
}

function validateCommitContext({ topLevel, branchName, guards }) {
  const activeGuards = Array.isArray(guards) ? guards.filter(Boolean) : [];
  if (activeGuards.length === 0) return { ok: true };
  const normalizedTop = normalizeFsPath(topLevel);
  const normalizedBranch = String(branchName || "").trim().toLowerCase();
  const matchingGuard = activeGuards.find((guard) => normalizeFsPath(guard.worktreePath) === normalizedTop);
  if (matchingGuard) {
    const expectedBranch = String(matchingGuard.branchName || "").trim().toLowerCase();
    if (!expectedBranch) return { ok: true };
    if (defaultBranchNames(matchingGuard.mergeTarget).has(normalizedBranch)) {
      return {
        ok: false,
        errorMessage: `Commit blocked: HEAD is on default branch '${branchName}'. Work item ${matchingGuard.workItemId} must commit on '${matchingGuard.branchName}'.`,
      };
    }
    if (normalizedBranch !== expectedBranch) {
      return {
        ok: false,
        errorMessage: `Commit blocked: HEAD is on '${branchName}', but work item ${matchingGuard.workItemId} is assigned to branch '${matchingGuard.branchName}'.`,
      };
    }
    return { ok: true };
  }
  const guardRepoPath = String(activeGuards[0]?.repoPath || "").trim();
  if (guardRepoPath && normalizeFsPath(guardRepoPath) === normalizedTop && defaultBranchNames(activeGuards[0]?.mergeTarget).has(normalizedBranch)) {
    const briefIds = activeGuards.map((guard) => guard.workItemId).filter(Boolean).join(", ");
    return {
      ok: false,
      errorMessage: `Commit blocked: active work-item run(s) (${briefIds}) require commits on assigned worktree branches, not '${branchName}' at the project repo root.`,
    };
  }
  return { ok: true };
}

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true }).trim();
}

let topLevel;
let branchName;
try {
  topLevel = git(["rev-parse", "--show-toplevel"], process.cwd());
  branchName = git(["rev-parse", "--abbrev-ref", "HEAD"], process.cwd());
} catch {
  process.exit(0);
}

const result = validateCommitContext({ topLevel, branchName, guards: readActiveGuards() });
if (!result.ok) {
  console.error(result.errorMessage);
  process.exit(1);
}
