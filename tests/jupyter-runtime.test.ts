import fs from "node:fs/promises";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";

import { VaultError } from "@/server/vault/errors";
import {
  __resetForTesting,
  __testInternals,
  ensureProjectWorkspaceSession,
  ensureSession,
  getProjectWorkspaceStatus,
  getSessionStatus,
  resolveJupyterExecutable,
  stopAllSessions,
  stopProjectWorkspaceSession,
  stopSession,
} from "@/server/jupyter/runtime";
import { resolveProjectWorkspace } from "@/server/jupyter/workspace-root";

const RUNTIME_REGISTRY_KEY = "__smartNotesJupyterSessions__";

async function withVaultFixture(
  run: (ctx: { vaultRoot: string; jupyterPagePath: string }) => Promise<void>
) {
  const previousVault = process.env.SMART_NOTES_VAULT;
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "smart-notes-jrt-"));
  process.env.SMART_NOTES_VAULT = vaultRoot;

  try {
    const sectionAbs = path.join(vaultRoot, "Notebook", "Section");
    await fs.mkdir(sectionAbs, { recursive: true });
    // A jupyter note stub + backing folder + notebook file.
    await fs.writeFile(
      path.join(sectionAbs, "analysis.html"),
      "---\ntitle: Analysis\nnote_type: jupyter\n---\n",
      "utf8"
    );
    const folder = path.join(sectionAbs, "analysis.jupyter");
    await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(
      path.join(folder, "notebook.ipynb"),
      JSON.stringify({ cells: [], metadata: {}, nbformat: 4, nbformat_minor: 5 }),
      "utf8"
    );
    await run({ vaultRoot, jupyterPagePath: "Notebook/Section/analysis.html" });
  } finally {
    if (previousVault) {
      process.env.SMART_NOTES_VAULT = previousVault;
    } else {
      delete process.env.SMART_NOTES_VAULT;
    }
    await fs.rm(vaultRoot, { recursive: true, force: true });
  }
}

describe("jupyter runtime — pure helpers (SN-101)", () => {
  afterEach(() => {
    __resetForTesting();
    delete process.env.SMART_NOTES_JUPYTER_CMD;
    delete process.env.SMART_NOTES_JUPYTER_PROFILE_DIR;
    delete process.env.SMART_NOTES_STATE_DIR;
    delete process.env.SMART_NOTES_JUPYTER_FRAME_ORIGINS;
  });

  it("honors the SMART_NOTES_JUPYTER_CMD override immediately", async () => {
    process.env.SMART_NOTES_JUPYTER_CMD = "C:/fake/jupyter.exe";
    await expect(resolveJupyterExecutable()).resolves.toBe("C:/fake/jupyter.exe");
  });

  it("prefers the Smart Notes profile executable over PATH Jupyter", async () => {
    const profileRoot = await fs.mkdtemp(path.join(os.tmpdir(), "smart-notes-jupyter-profile-"));
    const executable = process.platform === "win32"
      ? path.join(profileRoot, "Scripts", "jupyter.exe")
      : path.join(profileRoot, "bin", "jupyter");
    await fs.mkdir(path.dirname(executable), { recursive: true });
    await fs.writeFile(executable, "profile fixture", "utf8");
    process.env.SMART_NOTES_JUPYTER_PROFILE_DIR = profileRoot;

    await expect(resolveJupyterExecutable()).resolves.toBe(executable);
    await fs.rm(profileRoot, { recursive: true, force: true });
  });

  it("reports the same SMART_NOTES_JUPYTER_CMD executable used by launch", async () => {
    process.env.SMART_NOTES_JUPYTER_CMD = process.execPath;
    await expect(__testInternals.resolveJupyterSelection()).resolves.toMatchObject({
      source: "override",
      executable: process.execPath,
    });
  });

  it("runs profile commands without blocking the event loop", async () => {
    const command = __testInternals.runCommand(
      process.execPath,
      ["-e", "setTimeout(() => process.exit(0), 25)"],
      { timeoutMs: 1_000 }
    );
    let immediateRan = false;
    setImmediate(() => {
      immediateRan = true;
    });

    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(immediateRan).toBe(true);
    await expect(command).resolves.toMatchObject({ status: 0 });
  });

  it("matches enabled only on the jupyter_lsp extension row", () => {
    expect(__testInternals.isJupyterLspEnabled([
      "jupyter_lsp disabled",
      "other_extension enabled",
    ].join("\n"))).toBe(false);
    expect(__testInternals.isJupyterLspEnabled([
      "jupyter_lsp enabled",
      "other_extension disabled",
    ].join("\n"))).toBe(true);
  });

  it("prepends the selected profile Scripts directory for Jupyter subcommands", () => {
    const executable = process.platform === "win32"
      ? "C:\\smart-notes-profile\\Scripts\\jupyter.exe"
      : "/smart-notes-profile/bin/jupyter";
    const env = __testInternals.executableEnv(executable);
    expect(env.PATH?.split(path.delimiter)[0]).toBe(path.dirname(executable));
  });

  it("builds a config with a loopback bind, token, and forward-slash root", () => {
    const cfg = __testInternals.buildConfig("C:\\vault\\Notebook\\Section\\a.jupyter", 8888, "tok123");
    expect(cfg).toContain('c.ServerApp.ip = "127.0.0.1"');
    expect(cfg).toContain("c.ServerApp.port = 8888");
    expect(cfg).toContain('c.ServerApp.base_url = "/"');
    expect(cfg).toContain("c.LabApp.expose_app_in_browser = True");
    expect(cfg).toContain("c.ServerApp.allow_remote_access = True");
    expect(cfg).toContain("c.ServerApp.trust_xheaders = True");
    expect(cfg).toContain('c.IdentityProvider.token = "tok123"');
    // Backslashes are normalized so the raw Python string stays valid.
    expect(cfg).toContain('root_dir = r"C:/vault/Notebook/Section/a.jupyter"');
    expect(cfg).not.toContain("\\");
  });

  it("enables jupyter-lsp and pins pylsp launch/default autocomplete settings", async () => {
    const settingsDir = await fs.mkdtemp(path.join(os.tmpdir(), "smart-notes-lab-settings-"));
    const cfg = __testInternals.buildConfig(
      "C:\\vault\\Filtering Lab.jupyter",
      8888,
      "tok123",
      [],
      "/",
      {
        enabled: true,
        pylspExecutable: "C:\\profile\\Scripts\\pylsp.exe",
        userSettingsDir: settingsDir,
        workspacesDir: path.join(settingsDir, "workspaces"),
      }
    );
    expect(cfg).toContain('c.ServerApp.jpserver_extensions = {"jupyter_lsp": True}');
    expect(cfg).toContain("c.LanguageServerManager.language_servers");
    expect(cfg).toContain('"argv": [r"C:/profile/Scripts/pylsp.exe"]');
    expect(cfg).toContain("c.LabApp.user_settings_dir");
    expect(cfg).toContain("c.LabApp.workspaces_dir");

    await __testInternals.writeLabUserSettings(settingsDir);
    const completer = await fs.readFile(
      path.join(settingsDir, "@jupyterlab", "completer-extension", "manager.jupyterlab-settings"),
      "utf8"
    );
    const lsp = await fs.readFile(
      path.join(settingsDir, "@jupyter-lsp", "jupyterlab-lsp", "plugin.jupyterlab-settings"),
      "utf8"
    );
    expect(JSON.parse(completer)).toEqual({ autoCompletion: true });
    expect(JSON.parse(lsp)).toMatchObject({
      language_servers: {
        pylsp: {
          priority: 100,
          serverSettings: {
            "pylsp.plugins.jedi_completion.include_params": true,
            "pylsp.plugins.jedi_signature_help.enabled": true,
          },
        },
      },
    });
    expect(JSON.parse(await fs.readFile(
      path.join(settingsDir, "@jupyter-lsp", "jupyterlab-lsp", "completion.jupyterlab-settings"),
      "utf8"
    ))).toEqual({ continuousHinting: false });

    const themePath = path.join(settingsDir, "@jupyterlab", "apputils-extension", "themes.jupyterlab-settings");
    const editorPath = path.join(settingsDir, "@jupyterlab", "fileeditor-extension", "plugin.jupyterlab-settings");
    const notebookPath = path.join(settingsDir, "@jupyterlab", "notebook-extension", "tracker.jupyterlab-settings");
    const terminalPath = path.join(settingsDir, "@jupyterlab", "terminal-extension", "plugin.jupyterlab-settings");
    expect(JSON.parse(await fs.readFile(themePath, "utf8"))).toMatchObject({
      "adaptive-theme": true,
      "preferred-light-theme": "JupyterLab Light",
      "preferred-dark-theme": "JupyterLab Dark",
      overrides: { "code-font-size": "13px", "ui-font-size1": "13px" },
    });
    expect(JSON.parse(await fs.readFile(editorPath, "utf8"))).toMatchObject({
      editorConfig: {
        autoClosingBrackets: true,
        codeFolding: true,
        lineNumbers: true,
        matchBrackets: true,
        tabSize: 4,
      },
    });
    expect(JSON.parse(await fs.readFile(notebookPath, "utf8"))).toMatchObject({
      codeCellConfig: { lineNumbers: true },
      recordTiming: true,
    });
    expect(JSON.parse(await fs.readFile(terminalPath, "utf8"))).toMatchObject({
      fontSize: 13,
      theme: "inherit",
      scrollback: 10_000,
    });

    // Curated values are defaults, not a launch-time policy: owner changes and
    // unrelated settings survive later workspace starts.
    await fs.writeFile(editorPath, JSON.stringify({
      editorConfig: { fontSize: 16, lineNumbers: false },
      scrollPastEnd: false,
      toolbar: [{ name: "owner-command", command: "docmanager:save" }],
    }), "utf8");
    await __testInternals.writeLabUserSettings(settingsDir);
    expect(JSON.parse(await fs.readFile(editorPath, "utf8"))).toMatchObject({
      editorConfig: {
        fontSize: 16,
        lineNumbers: false,
        autoClosingBrackets: true,
      },
      scrollPastEnd: false,
      toolbar: [{ name: "owner-command", command: "docmanager:save" }],
    });
    await fs.rm(settingsDir, { recursive: true, force: true });
  });

  it("keeps Lab user settings and workspaces in durable app state", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "smart-notes-state-"));
    process.env.SMART_NOTES_STATE_DIR = stateDir;
    const paths = __testInternals.jupyterLabStatePaths();

    expect(paths.userSettingsDir).toBe(path.join(stateDir, "jupyter", "lab", "user-settings"));
    expect(paths.workspacesDir).toBe(path.join(stateDir, "jupyter", "lab", "workspaces"));
    expect(paths.userSettingsDir).not.toContain(`${path.sep}smart-notes-jupyter${path.sep}session-`);

    await __testInternals.writeLabUserSettings(paths.userSettingsDir);
    await fs.mkdir(paths.workspacesDir, { recursive: true });
    await fs.writeFile(path.join(paths.workspacesDir, "layout.json"), "keep me", "utf8");
    await __testInternals.writeLabUserSettings(paths.userSettingsDir);
    await expect(fs.readFile(path.join(paths.workspacesDir, "layout.json"), "utf8")).resolves.toBe("keep me");
    await fs.rm(stateDir, { recursive: true, force: true });
  });

  it("prepares launch settings without changing the Filtering Lab fixture", async () => {
    const fixture = path.resolve("tests", "fixtures", "filtering-lab", "notebook.ipynb");
    const before = crypto.createHash("sha256").update(await fs.readFile(fixture)).digest("hex");
    const settingsDir = await fs.mkdtemp(path.join(os.tmpdir(), "smart-notes-filtering-lab-settings-"));
    await __testInternals.writeLabUserSettings(settingsDir);
    const after = crypto.createHash("sha256").update(await fs.readFile(fixture)).digest("hex");

    expect(after).toBe(before);
    expect(path.resolve(settingsDir)).not.toContain(`${path.sep}filtering-lab${path.sep}`);
    await fs.rm(settingsDir, { recursive: true, force: true });
  });

  it("whitelists the app origin (and env extras) for iframe embedding", () => {
    const base = __testInternals.frameAncestors();
    expect(base).toContain("'self'");
    expect(base).toMatch(/http:\/\/localhost:\d+/);
    expect(base).toContain("http://localhost:*");
    expect(base).toContain("http://127.0.0.1:*");
    expect(base).not.toContain("http://[::1]:*");

    process.env.SMART_NOTES_JUPYTER_FRAME_ORIGINS = "https://notes.example.com";
    expect(__testInternals.frameAncestors()).toContain("https://notes.example.com");
  });

  it("adds the launching browser origin to the frame-ancestors header", () => {
    const cfg = __testInternals.buildConfig("C:\\vault\\Notebook\\Section\\a.jupyter", 8888, "tok123", [
      "http://localhost:4317",
      "not a url",
    ], "/api/jupyter/proxy/proxy-1/");
    expect(cfg).toContain("frame-ancestors");
    expect(cfg).toContain('c.ServerApp.base_url = "/api/jupyter/proxy/proxy-1/"');
    expect(cfg).toContain("http://localhost:4317");
    expect(cfg).not.toContain("not a url");
  });

  it("normalizes exact and wildcard local frame origins", () => {
    expect(__testInternals.normalizeFrameOrigin("http://LOCALHOST:4317/path")).toBe("http://localhost:4317");
    expect(__testInternals.normalizeFrameOrigin("http://localhost:*")).toBe("http://localhost:*");
    expect(__testInternals.normalizeFrameOrigin("file://app")).toBeNull();
  });

  it("uses the app loopback hostname for browser-facing Jupyter URLs", () => {
    expect(__testInternals.publicLoopbackHost(["http://localhost:4317"])).toBe("localhost");
    expect(__testInternals.publicLoopbackHost(["http://127.0.0.1:4317"])).toBe("127.0.0.1");
    expect(__testInternals.publicLoopbackHost(["https://notes.example.com"])).toBe("127.0.0.1");
  });

  it("builds a lab URL targeting the notebook file with its token", () => {
    const url = __testInternals.labUrl("/api/jupyter/proxy/proxy-1/", "notebook.ipynb", "tok123");
    expect(url).toBe("/api/jupyter/proxy/proxy-1/lab/tree/notebook.ipynb?token=tok123");
  });

  it("builds per-session proxy base paths", () => {
    expect(__testInternals.proxyBasePath("abc/123")).toBe("/api/jupyter/proxy/abc%2F123/");
  });

  it("allocates a usable free port", async () => {
    const port = await __testInternals.findFreePort();
    expect(port).toBeGreaterThan(0);
    expect(port).toBeLessThan(65536);
  });
});

describe("jupyter runtime — error states (SN-101)", () => {
  afterEach(() => {
    __resetForTesting();
    delete process.env.SMART_NOTES_JUPYTER_CMD;
    delete process.env.SMART_NOTES_JUPYTER_PROFILE_DIR;
  });

  it("reports NOTEBOOK_UNAVAILABLE when the working folder is missing", async () => {
    await withVaultFixture(async ({ vaultRoot }) => {
      // Point at a jupyter note whose .jupyter folder does not exist.
      const sectionAbs = path.join(vaultRoot, "Notebook", "Section");
      await fs.writeFile(
        path.join(sectionAbs, "ghost.html"),
        "---\ntitle: Ghost\nnote_type: jupyter\n---\n",
        "utf8"
      );

      const view = await getSessionStatus("Notebook/Section/ghost.html");
      expect(view.status).toBe("error");
      expect(view.errorCode).toBe("NOTEBOOK_UNAVAILABLE");
    });
  });

  it("reports NOTEBOOK_UNAVAILABLE from ensureSession when the notebook file is gone", async () => {
    await withVaultFixture(async ({ vaultRoot }) => {
      await fs.rm(path.join(vaultRoot, "Notebook", "Section", "analysis.jupyter", "notebook.ipynb"), {
        force: true,
      });
      await expect(ensureSession("Notebook/Section/analysis.html")).rejects.toMatchObject({
        code: "NOTEBOOK_UNAVAILABLE",
      });
    });
  });

  it("surfaces JUPYTER_MISSING when the configured executable cannot be launched", async () => {
    await withVaultFixture(async ({ jupyterPagePath }) => {
      // Override points at a non-existent binary → spawn emits ENOENT → mapped
      // to JUPYTER_MISSING without waiting for the full readiness timeout.
      process.env.SMART_NOTES_JUPYTER_CMD = path.join(os.tmpdir(), "definitely-not-jupyter-xyz");
      await expect(ensureSession(jupyterPagePath)).rejects.toMatchObject({
        code: "JUPYTER_MISSING",
      });
    });
  }, 15000);

  it("returns stopped:false when stopping a note with no running session", async () => {
    await withVaultFixture(async ({ jupyterPagePath }) => {
      const result = await stopSession(jupyterPagePath);
      expect(result.stopped).toBe(false);
    });
  });

  it("returns stopped:0 when stopping all sessions with no running servers", async () => {
    const result = await stopAllSessions();
    expect(result.stopped).toBe(0);
  });

  it("reports a stopped session for a healthy note with no server yet", async () => {
    await withVaultFixture(async ({ jupyterPagePath }) => {
      const view = await getSessionStatus(jupyterPagePath);
      expect(view.status).toBe("stopped");
      expect(view).not.toHaveProperty("errorCode", "NOTEBOOK_UNAVAILABLE");
    });
  });

  it("wraps a VaultError with the expected code type", () => {
    const error = new VaultError("JUPYTER_MISSING", "nope", 503);
    expect(error.code).toBe("JUPYTER_MISSING");
    expect(error.status).toBe(503);
  });
});

async function withProjectWorkspace(
  run: (ctx: { worktree: string }) => Promise<void>
): Promise<void> {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "smart-notes-project-workspace-"));
  const worktree = path.join(parent, "av-sn-256-worktree");
  await fs.mkdir(worktree, { recursive: true });
  try {
    await run({ worktree });
  } finally {
    await fs.rm(parent, { recursive: true, force: true });
  }
}

describe("jupyter runtime — project-backed workspace sessions (SN-256)", () => {
  afterEach(() => {
    __resetForTesting();
    delete process.env.SMART_NOTES_JUPYTER_CMD;
  });

  it("reports a stopped status for an existing workspace with no launched session", async () => {
    await withProjectWorkspace(async ({ worktree }) => {
      const view = await getProjectWorkspaceStatus({ rootPath: worktree, branch: "av/sn-256-feature" });
      expect(view.status).toBe("stopped");
      expect(view.rootPath).toBe(worktree);
      expect(view.accessMode).toBe("read-only");
    });
  });

  it("returns stopped:false stopping a project workspace with no running session", async () => {
    await withProjectWorkspace(async ({ worktree }) => {
      const result = await stopProjectWorkspaceSession({ rootPath: worktree });
      expect(result.stopped).toBe(false);
    });
  });

  it("attempts launch (no notebook.ipynb or parent allowlist required) and surfaces JUPYTER_MISSING", async () => {
    await withProjectWorkspace(async ({ worktree }) => {
      // The worktree has no notebook.ipynb and no other files at all — unlike
      // note-owned sessions this must not raise NOTEBOOK_UNAVAILABLE; it should
      // proceed all the way to spawning Jupyter and fail there instead.
      process.env.SMART_NOTES_JUPYTER_CMD = path.join(os.tmpdir(), "definitely-not-jupyter-xyz");
      await expect(
        ensureProjectWorkspaceSession({ rootPath: worktree, branch: "av/sn-256-feature", requestedAccess: "editable" })
      ).rejects.toMatchObject({ code: "JUPYTER_MISSING" });
    });
  }, 15000);

  it("keeps the default branch read-only even when an editable open is later requested for the same root", async () => {
    // Access-mode policy is derived per-request; this asserts the resolver
    // itself never lets a default-branch request through as editable,
    // independent of session reuse. Full reuse behavior against a live
    // session is exercised by resolveAccessMode + resolveProjectWorkspace
    // unit tests in jupyter-workspace-root.test.ts.
    await withProjectWorkspace(async ({ worktree }) => {
      const view = await getProjectWorkspaceStatus({
        rootPath: worktree,
        branch: "main",
        requestedAccess: "editable",
      });
      expect(view.accessMode).toBe("read-only");
    });
  });

  it("SN-256 review fix: never widens a live session's access mode from read-only to editable in place", async () => {
    await withProjectWorkspace(async ({ worktree }) => {
      process.env.SMART_NOTES_JUPYTER_CMD = path.join(os.tmpdir(), "definitely-not-jupyter-xyz");

      // Seed a fake "ready" session directly in the shared registry so the
      // resume path is exercised without actually spawning Jupyter (not
      // installed under test). The key must match what resolveProjectWorkspace
      // computes for this root.
      const resolved = await resolveProjectWorkspace({ rootPath: worktree, branch: "main" });
      const fakeSession = {
        key: resolved.key,
        pagePath: worktree,
        folder: resolved.realRoot,
        proxyId: "fake-proxy",
        proxyBasePath: "/api/jupyter/proxy/fake-proxy/",
        port: 1,
        token: "tok",
        baseUrl: "http://127.0.0.1:1",
        frameOrigins: [] as string[],
        status: "ready" as const,
        startedAt: new Date().toISOString(),
        logTail: "",
        kind: "project" as const,
        accessMode: "read-only" as const,
        workspaceMeta: { rootPath: resolved.realRoot, branch: "main" },
      };
      const g = globalThis as unknown as Record<string, unknown>;
      g[RUNTIME_REGISTRY_KEY] = new Map([[resolved.key, fakeSession]]);
      const previousFetch = globalThis.fetch;
      // Only the seeded fake session's loopback URL pings "ready" — a real
      // spawn attempt (from the widen-triggered relaunch below) must go
      // through its own genuine spawn-error path rather than being told it's
      // ready by this stub, which would mask the very regression this test
      // guards against.
      globalThis.fetch = jest.fn((url: unknown) => {
        if (typeof url === "string" && url.startsWith("http://127.0.0.1:1/")) {
          return Promise.resolve({ ok: true } as Response);
        }
        return Promise.reject(new Error("connection refused (test stub)"));
      }) as unknown as typeof fetch;

      try {
        // Re-resolving to the same (default-branch, read-only) policy must
        // reuse the live session in place — no relaunch.
        const stillReadOnly = await ensureProjectWorkspaceSession({ rootPath: worktree, branch: "main" });
        expect(stillReadOnly.status).toBe("ready");
        expect(stillReadOnly.accessMode).toBe("read-only");

        // A resume that now resolves to editable (legitimate branch switch or
        // a forged request) must never just flip accessMode on the running
        // session — it must force a full relaunch. With no real jupyter
        // executable available, that relaunch fails loudly (JUPYTER_MISSING)
        // instead of silently handing back an escalated live session.
        await expect(
          ensureProjectWorkspaceSession({ rootPath: worktree, branch: "feature/x", requestedAccess: "editable" })
        ).rejects.toMatchObject({ code: "JUPYTER_MISSING" });

        // The old read-only "ready" session was torn down as part of that
        // relaunch attempt — what's in the registry now is the failed
        // relaunch attempt itself (status "error"), never the stale session
        // left running with its access mode silently flipped to editable.
        const registryAfter = (globalThis as unknown as Record<string, unknown>)[RUNTIME_REGISTRY_KEY] as Map<
          string,
          { status: string; accessMode?: string; errorCode?: string }
        >;
        const afterRelaunchAttempt = registryAfter.get(resolved.key);
        expect(afterRelaunchAttempt?.status).toBe("error");
        expect(afterRelaunchAttempt?.errorCode).toBe("JUPYTER_MISSING");
      } finally {
        globalThis.fetch = previousFetch;
      }
    });
  }, 15000);
});
