/**
 * SN-409 capability-bound Companion Git: command policy and real-repository flows.
 * Every repository here is disposable (os.tmpdir); the "remote" is a local bare repo.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { POST as postWorkspaceGit } from "@/app/api/workspace/git/route";
import {
  issueWorkspaceCapability,
  resetWorkspaceCapabilitiesForTesting,
} from "@/server/jupyter/workspace-capability";
import {
  classifyGitFailure,
  defaultRunGit,
  gitEnvironment,
  NO_HOOKS_PATH,
  parseGitPaths,
  resetWorkspaceGitForTesting,
  ownerMessageRequestsPush,
  runWorkspaceGit,
  type CompanionTurnView,
  type GitRunner,
  type WorkspaceGitDeps,
} from "@/server/jupyter/workspace-git";
import { resolveProjectWorkspace } from "@/server/jupyter/workspace-root";

const { workspaceToolRequest, WORKSPACE_TOOLS } = require("../server/companion-log-form-bridge");

jest.setTimeout(60_000);

const BRANCH = "av/sn-409-demo";

function sh(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", env: gitEnvironment(cwd), windowsHide: true }).trim();
}

describe("SN-409 Companion Git in a Deep Work workspace", () => {
  let parent: string;
  let root: string;
  let remote: string;
  let argvLog: string[][];
  let turns: Map<string, CompanionTurnView>;
  const runGit: GitRunner = (args, options) => {
    argvLog.push(args);
    return defaultRunGit(args, options);
  };

  async function capabilityFor(rootPath: string, access: "editable" | "read-only" = "editable", branch = BRANCH) {
    const request = { rootPath, projectId: "proj", repoId: "repo", workItemId: "SN-409", branch, requestedAccess: access };
    return issueWorkspaceCapability(request, await resolveProjectWorkspace(request)).capability;
  }

  // Owner turns default to a message that asks to commit and push.
  function turn(
    capability: string,
    turnId: string,
    ownerInitiated = true,
    ownerMessage = "commit and push"
  ): string {
    turns.set(turnId, {
      turnId,
      status: "running",
      threadKey: `${capability}::companion`,
      appContext: `- workspaceCapability: ${capability}\n- companionTurnId: ${turnId}`,
      ownerInitiated,
      ownerMessage: ownerInitiated === false ? "" : ownerMessage,
    });
    return turnId;
  }

  const deps = (): WorkspaceGitDeps => ({ runGit, getTurn: (id) => turns.get(id) ?? null });
  const git = (capability: string, operation: string, args: Record<string, unknown> = {}) =>
    runWorkspaceGit(capability, operation, args, deps());
  const rejects = async (promise: Promise<unknown>, code: string) => {
    await expect(promise).rejects.toMatchObject({ code });
  };

  beforeEach(async () => {
    resetWorkspaceCapabilitiesForTesting();
    resetWorkspaceGitForTesting();
    argvLog = [];
    turns = new Map();
    parent = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "sn409-")));
    remote = path.join(parent, "remote.git");
    root = path.join(parent, "worktree");
    await fs.mkdir(root);
    sh(parent, "init", "--bare", "-q", remote);
    sh(root, "init", "-q", "-b", BRANCH);
    sh(root, "config", "user.name", "SN-409 Test");
    sh(root, "config", "user.email", "sn409@example.invalid");
    sh(root, "config", "commit.gpgsign", "false");
    sh(root, "config", "core.autocrlf", "false");
    await fs.writeFile(path.join(root, "a.txt"), "one\n");
    await fs.writeFile(path.join(root, "owner.txt"), "owner\n");
    sh(root, "add", "a.txt", "owner.txt");
    sh(root, "commit", "-q", "-m", "initial");
    sh(root, "remote", "add", "origin", remote);
    sh(root, "push", "-q", "-u", "origin", BRANCH);
  });

  afterEach(async () => {
    resetWorkspaceCapabilitiesForTesting();
    resetWorkspaceGitForTesting();
    delete process.env.GIT_DIR;
    await fs.rm(parent, { recursive: true, force: true, maxRetries: 3 });
  });

  it("inspects status, diff, and log with exit status and bounded output", async () => {
    const capability = await capabilityFor(root);
    await fs.writeFile(path.join(root, "a.txt"), "one\ntwo\n");
    const status = await git(capability, "status");
    expect(status.results[0]).toMatchObject({ exitCode: 0, truncated: false, timedOut: false });
    expect(status.results[0].stdout).toContain(`## ${BRANCH}...origin/${BRANCH}`);
    expect(status.results[0].stdout).toContain(" M a.txt");
    const diff = await git(capability, "diff");
    expect(diff.results[0].stdout).toContain("+two");
    const log = await git(capability, "log", { maxCount: 5 });
    expect(log.results[0].stdout.trim()).toMatch(/^[0-9a-f]{40}\tSN-409 Test\t.+\tinitial$/);
    await rejects(git(capability, "log", { maxCount: 1000 }), "INVALID_INPUT");
  });

  it("bounds a large diff and never shows secret-shaped file content", async () => {
    const capability = await capabilityFor(root);
    await fs.writeFile(path.join(root, "a.txt"), `${"x".repeat(200)}\n`.repeat(600));
    await fs.writeFile(path.join(root, ".env"), "TOKEN=old\n");
    sh(root, "add", ".env");
    sh(root, "commit", "-q", "-m", "env");
    await fs.writeFile(path.join(root, ".env"), "TOKEN=supersecret\n");
    const diff = await git(capability, "diff");
    expect(diff.results[0].truncated).toBe(true);
    expect(diff.results[0].stdout.length).toBeLessThanOrEqual(64 * 1024);
    expect(diff.omittedSecretPaths).toBe(1);
    expect(diff.results[0].stdout).not.toContain("supersecret");
    await rejects(git(capability, "diff", { paths: [".env"] }), "WORKSPACE_PATH_BLOCKED");
  });

  it("stages named files only and commits without sweeping in owner changes", async () => {
    const capability = await capabilityFor(root);
    await fs.writeFile(path.join(root, "a.txt"), "companion edit\n");
    await fs.writeFile(path.join(root, "owner.txt"), "owner uncommitted\n");
    await fs.mkdir(path.join(root, "dir"));
    await fs.writeFile(path.join(root, "dir", "new.txt"), "new\n");

    await rejects(git(capability, "stage", { paths: ["dir"] }), "GIT_PATH_IS_DIRECTORY");
    await rejects(git(capability, "stage", { paths: ["../escape.txt"] }), "WORKSPACE_PATH_BLOCKED");
    await rejects(git(capability, "stage", { paths: [".git/config"] }), "WORKSPACE_PATH_BLOCKED");
    await rejects(git(capability, "stage", { paths: ["config/secrets.json"] }), "WORKSPACE_PATH_BLOCKED");
    await rejects(git(capability, "stage", { paths: ["C:/Windows/win.ini"] }), "WORKSPACE_PATH_BLOCKED");
    await rejects(git(capability, "stage", { paths: ["*.txt"] }), "GIT_PATH_UNCHANGED");
    await rejects(git(capability, "stage", { paths: [] }), "INVALID_INPUT");

    const staged = await git(capability, "stage", { paths: ["a.txt", "dir/new.txt"] });
    expect(staged.results[0].exitCode).toBe(0);
    expect(sh(root, "diff", "--cached", "--name-only").split(/\r?\n/).sort()).toEqual(["a.txt", "dir/new.txt"]);

    const commit = await git(capability, "commit", { message: "Companion change", paths: ["a.txt", "dir/new.txt"] });
    expect(commit.results[0].exitCode).toBe(0);
    expect(commit.committed).toEqual(["a.txt", "dir/new.txt"]);
    expect(sh(root, "show", "--name-only", "--format=%s", "HEAD").split(/\r?\n/).filter(Boolean)).toEqual([
      "Companion change", "a.txt", "dir/new.txt",
    ]);
    // The owner's unstaged change is untouched and uncommitted.
    expect(await fs.readFile(path.join(root, "owner.txt"), "utf8")).toBe("owner uncommitted\n");
    expect(sh(root, "status", "--short")).toBe("M owner.txt");
  });

  it("refuses a commit when the owner has other staged changes, and can unstage named paths", async () => {
    const capability = await capabilityFor(root);
    await fs.writeFile(path.join(root, "owner.txt"), "owner staged\n");
    sh(root, "add", "owner.txt");
    await fs.writeFile(path.join(root, "a.txt"), "companion\n");
    await git(capability, "stage", { paths: ["a.txt"] });
    const before = sh(root, "rev-parse", "HEAD");
    await expect(git(capability, "commit", { message: "mine", paths: ["a.txt"] })).rejects.toMatchObject({
      code: "GIT_STAGED_SET_MISMATCH",
      hint: expect.stringContaining("owner.txt"),
    });
    expect(sh(root, "rev-parse", "HEAD")).toBe(before);
    await rejects(git(capability, "commit", { message: "  ", paths: ["a.txt"] }), "INVALID_INPUT");

    await git(capability, "unstage", { paths: ["a.txt"] });
    expect(sh(root, "diff", "--cached", "--name-only")).toBe("owner.txt");
    expect(await fs.readFile(path.join(root, "a.txt"), "utf8")).toBe("companion\n");
  });

  it("cannot escape the capability root or act on another repository", async () => {
    // A root nested inside a repository never reaches the parent repository:
    // discovery is ceilinged at the root's parent.
    await fs.mkdir(path.join(root, "nested"));
    await expect(git(await capabilityFor(path.join(root, "nested")), "status")).rejects.toMatchObject({
      code: "GIT_NOT_REPOSITORY",
      hint: expect.stringContaining("nested"),
    });

    // A plain folder inside a repo-free parent is not a repository (ceiling stops discovery).
    const plain = path.join(parent, "plain");
    await fs.mkdir(plain);
    await rejects(git(await capabilityFor(plain), "status"), "GIT_NOT_REPOSITORY");

    // An inherited GIT_DIR cannot redirect the command to another repository.
    const other = path.join(parent, "other");
    await fs.mkdir(other);
    sh(other, "init", "-q", "-b", "other-branch");
    process.env.GIT_DIR = path.join(other, ".git");
    const status = await git(await capabilityFor(root), "status");
    expect(status.results[0].stdout).toContain(`## ${BRANCH}`);

    await rejects(git("dwc_forged", "status"), "INVALID_WORKSPACE_CAPABILITY");
  });

  it("keeps destructive and arbitrary operations unavailable", async () => {
    const capability = await capabilityFor(root);
    for (const operation of ["reset", "exec", "shell", "branch", "checkout", "rebase", "merge", "stash", "clean", "tag", "release", "push --force"]) {
      await rejects(git(capability, operation), "GIT_OPERATION_NOT_ALLOWED");
    }
    for (const tool of ["workspace_git_reset", "workspace_git_exec", "workspace_git_raw", "workspace_shell"]) {
      expect(WORKSPACE_TOOLS.has(tool)).toBe(false);
    }
    // A smuggled operation arg cannot change the tool's operation.
    const mapped = workspaceToolRequest("workspace_git_status", { workspace: capability, operation: "push" }, "http://127.0.0.1:1");
    expect(mapped).toEqual({
      endpoint: "http://127.0.0.1:1/api/workspace/git",
      method: "POST",
      body: { workspace: capability, operation: "status" },
    });
  });

  it("is read-only for a read-only capability and refuses a switched branch", async () => {
    await fs.writeFile(path.join(root, "a.txt"), "x\n");
    const readOnly = await capabilityFor(root, "read-only");
    expect((await git(readOnly, "status")).ok).toBe(true);
    for (const operation of ["stage", "unstage", "commit", "fetch", "pull", "push"]) {
      await rejects(git(readOnly, operation, { paths: ["a.txt"], message: "m" }), "WORKSPACE_READ_ONLY");
    }
    // Owner switched this worktree to another branch after launch.
    const editable = await capabilityFor(root);
    sh(root, "checkout", "-q", "-b", "other");
    await rejects(git(editable, "stage", { paths: ["a.txt"] }), "GIT_BRANCH_MISMATCH");
  });

  it("never runs repository hooks, even ones the Companion could have authored", async () => {
    const capability = await capabilityFor(root);
    const marker = path.join(parent, "hook-ran.txt").split(path.sep).join("/");
    const hook = `#!/bin/sh\necho ran >> "${marker}"\n`;
    for (const name of ["pre-commit", "commit-msg", "post-commit", "pre-push"]) {
      await fs.writeFile(path.join(root, ".git", "hooks", name), hook, { mode: 0o755 });
    }
    sh(root, "commit", "--allow-empty", "-q", "-m", "sanity: hooks do run for direct git");
    expect(await fs.readFile(marker, "utf8")).toContain("ran");
    await fs.rm(marker);

    await fs.writeFile(path.join(root, "a.txt"), "hooked\n");
    await git(capability, "stage", { paths: ["a.txt"] });
    await git(capability, "commit", { message: "no hooks", paths: ["a.txt"] });
    await git(capability, "push", { turnId: turn(capability, "11111111-1111-4111-8111-111111111111") });
    await expect(fs.access(marker)).rejects.toThrow();
  });

  it("treats an unconfirmed default-branch workspace as read-only", async () => {
    sh(root, "checkout", "-q", "-b", "main");
    await fs.writeFile(path.join(root, "a.txt"), "x\n");
    const capability = await capabilityFor(root, "editable", "main");
    expect((await git(capability, "status")).ok).toBe(true);
    await rejects(git(capability, "stage", { paths: ["a.txt"] }), "WORKSPACE_READ_ONLY");
  });

  it("pushes in one call when the owner's own message asks to push", async () => {
    const capability = await capabilityFor(root);
    await fs.writeFile(path.join(root, "a.txt"), "to push\n");
    await git(capability, "stage", { paths: ["a.txt"] });
    await git(capability, "commit", { message: "push me", paths: ["a.txt"] });
    const head = sh(root, "rev-parse", "HEAD");
    const remoteBefore = sh(remote, "rev-parse", BRANCH);

    await rejects(git(capability, "push", {}), "GIT_PUSH_TURN_REQUIRED");
    const otherCapability = await capabilityFor(root);
    await rejects(git(capability, "push", { turnId: turn(otherCapability, "44444444-4444-4444-8444-444444444444") }), "GIT_PUSH_TURN_REQUIRED");
    // dryRun previews without pushing.
    const ownerTurn = turn(capability, "33333333-3333-4333-8333-333333333333");
    const dry = await git(capability, "push", { turnId: ownerTurn, dryRun: true });
    expect(dry).toMatchObject({ status: "preview", remote: "origin", ref: `refs/heads/${BRANCH}`, sha: head });
    expect(dry.results[0].stdout).toContain("push me");
    expect(sh(remote, "rev-parse", BRANCH)).toBe(remoteBefore);

    argvLog = [];
    const pushed = await git(capability, "push", { turnId: ownerTurn, force: true });
    expect(pushed).toMatchObject({ status: "pushed", sha: head });
    expect(sh(remote, "rev-parse", BRANCH)).toBe(head);
    const pushArgv = argvLog.find((args) => args.includes("push"))!;
    expect(pushArgv.join(" ")).not.toMatch(/--force|-f\b|--delete|--mirror|--tags|\+/);
    expect(pushArgv.slice(-2)).toEqual(["origin", `${head}:refs/heads/${BRANCH}`]);
    expect(pushArgv).toEqual(expect.arrayContaining(["--no-verify", `core.hooksPath=${NO_HOOKS_PATH}`]));
  });

  it("never pushes from a wake turn or when the owner did not ask, but honors a later owner yes", async () => {
    const capability = await capabilityFor(root);
    await fs.writeFile(path.join(root, "a.txt"), "owner words\n");
    sh(root, "commit", "-qam", "owner words");
    const remoteBefore = sh(remote, "rev-parse", BRANCH);

    const wake = await git(capability, "push", { turnId: turn(capability, "22222222-2222-4222-8222-222222222222", false) });
    expect(wake.status).toBe("owner_request_required");
    const unflagged = turn(capability, "77777777-7777-4777-8777-777777777777");
    delete turns.get(unflagged)!.ownerInitiated;
    expect((await git(capability, "push", { turnId: unflagged })).status).toBe("owner_request_required");
    const dont = turn(capability, "66666666-6666-4666-8666-666666666666", true, "commit it but don't push yet");
    expect((await git(capability, "push", { turnId: dont })).status).toBe("owner_request_required");
    const unrelated = turn(capability, "33333333-3333-4333-8333-333333333333", true, "fix the typo in the README");
    const asked = await git(capability, "push", { turnId: unrelated });
    expect(asked.status).toBe("owner_request_required");
    // Re-calling in the same turn still does not push.
    expect((await git(capability, "push", { turnId: unrelated })).status).toBe("owner_request_required");
    expect(sh(remote, "rev-parse", BRANCH)).toBe(remoteBefore);

    // The owner replies "yes" in a later turn to the proposed push.
    const yes = turn(capability, "88888888-8888-4888-8888-888888888888", true, "yes go ahead");
    expect((await git(capability, "push", { turnId: yes })).status).toBe("pushed");
    expect(sh(remote, "rev-parse", BRANCH)).toBe(sh(root, "rev-parse", "HEAD"));
  });

  it("detects an owner push request and its negations", () => {
    for (const text of ["commit and push", "Push it.", "please push to origin main", "commit, then pushing is fine", "did you push?"]) {
      expect(ownerMessageRequestsPush(text)).toBe(true);
    }
    for (const text of ["commit but don't push", "do not push", "commit without pushing", "not push yet", "fix the typo", "", undefined, "pushover"]) {
      expect(ownerMessageRequestsPush(text)).toBe(false);
    }
  });

  it("fetches, fast-forward pulls, and reports rejected pushes and divergence", async () => {
    const capability = await capabilityFor(root);
    const clone = path.join(parent, "clone");
    sh(parent, "clone", "-q", "-b", BRANCH, remote, clone);
    sh(clone, "config", "user.name", "Other");
    sh(clone, "config", "user.email", "other@example.invalid");
    sh(clone, "config", "core.autocrlf", "false");
    await fs.writeFile(path.join(clone, "b.txt"), "remote\n");
    sh(clone, "add", "b.txt");
    sh(clone, "commit", "-q", "-m", "remote change");
    sh(clone, "push", "-q");

    const fetched = await git(capability, "fetch");
    expect(fetched.results[0].exitCode).toBe(0);
    expect(fetched.results[1].stdout).toContain("behind 1");

    // Owner's uncommitted file that the pull would overwrite blocks the pull and survives.
    await fs.writeFile(path.join(root, "b.txt"), "owner untracked\n");
    await rejects(git(capability, "pull"), "GIT_LOCAL_CHANGES_BLOCK");
    expect(await fs.readFile(path.join(root, "b.txt"), "utf8")).toBe("owner untracked\n");
    await fs.rm(path.join(root, "b.txt"));

    await fs.writeFile(path.join(root, "owner.txt"), "owner unrelated\n");
    const pulled = await git(capability, "pull");
    expect(pulled.after).toBe(sh(clone, "rev-parse", "HEAD"));
    expect(await fs.readFile(path.join(root, "owner.txt"), "utf8")).toBe("owner unrelated\n");

    // Diverge: remote and local both advance.
    await fs.writeFile(path.join(clone, "b.txt"), "remote 2\n");
    sh(clone, "commit", "-qam", "remote 2");
    sh(clone, "push", "-q");
    await fs.writeFile(path.join(root, "a.txt"), "local\n");
    await git(capability, "stage", { paths: ["a.txt"] });
    await git(capability, "commit", { message: "local", paths: ["a.txt"] });
    await expect(git(capability, "push", {
      turnId: turn(capability, "33333333-3333-4333-8333-333333333333"),
    })).rejects.toMatchObject({ code: "GIT_PUSH_REJECTED", result: expect.objectContaining({ exitCode: 1 }) });
    await git(capability, "fetch");
    await rejects(git(capability, "pull"), "GIT_NOT_FAST_FORWARD");
  });

  it("classifies missing Git, authentication, and conflicts into actionable errors", async () => {
    const capability = await capabilityFor(root);
    const missing: GitRunner = async () => ({
      exitCode: null, stdout: "", stderr: "", timedOut: false,
      spawnError: Object.assign(new Error("spawn git ENOENT"), { code: "ENOENT" }),
    });
    await expect(runWorkspaceGit(capability, "status", {}, { runGit: missing })).rejects.toMatchObject({
      code: "GIT_NOT_FOUND",
      hint: expect.stringContaining("Install Git"),
    });
    const result = (stderr: string) => ({ command: "git x", exitCode: 128, stdout: "", stderr, truncated: false, timedOut: false });
    expect(classifyGitFailure("push", result("fatal: Authentication failed for 'https://example.invalid/r.git/'")).code).toBe("GIT_AUTH_FAILED");
    expect(classifyGitFailure("fetch", result("fatal: could not read Username for 'https://github.com': terminal prompts disabled")).code).toBe("GIT_AUTH_FAILED");
    expect(classifyGitFailure("fetch", result("git@github.com: Permission denied (publickey).")).code).toBe("GIT_AUTH_FAILED");
    expect(classifyGitFailure("pull", result("error: you need to resolve your current index first")).code).toBe("GIT_CONFLICT");
    expect(classifyGitFailure("commit", result("*** Please tell me who you are.")).code).toBe("GIT_IDENTITY_MISSING");
    expect(classifyGitFailure("push", result(" ! [rejected]        main -> main (fetch first)")).code).toBe("GIT_PUSH_REJECTED");
    expect(classifyGitFailure("fetch", { ...result(""), timedOut: true }).code).toBe("GIT_TIMEOUT");
    expect(() => parseGitPaths(["a", 3], { required: true })).toThrow();
  });

  it("serves the route with bounded results and structured errors", async () => {
    const capability = await capabilityFor(root);
    const call = (body: unknown) => postWorkspaceGit(new Request("http://localhost/api/workspace/git", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }));
    const ok = await call({ workspace: capability, operation: "status" });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true, operation: "status", results: [expect.objectContaining({ exitCode: 0 })] });
    const denied = await call({ workspace: capability, operation: "reset", args: ["--hard"] });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ code: "GIT_OPERATION_NOT_ALLOWED" });
    const conflict = await call({ workspace: capability, operation: "commit", message: "m", paths: ["a.txt"] });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ ok: false, code: "GIT_NOTHING_TO_COMMIT", hint: expect.any(String) });
  });
});
