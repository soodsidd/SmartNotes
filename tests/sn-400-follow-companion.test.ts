/** @jest-environment jsdom */

// SN-400: Follow Companion. Pure follow decisions plus the real injected
// JupyterLab bridge driven against a minimal fake Lab with two notebooks.

import { deepWorkFollowFromRunEvent, deepWorkFollowFromSourceEvent, readDeepWorkFollowPreference, writeDeepWorkFollowPreference } from "@/lib/deep-work-follow";
import { parseCompanionCommandEvent, upsertCompanionCommand, countRunningCompanionCommands } from "@/lib/companion-command-activity";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { JUPYTER_FOCUS_BRIDGE_SOURCE } = require("../server/jupyter-focus-bridge");

const ROOT = "C:/Work/LeRobot";
const base = { followEnabled: true, deepWorkActive: true, sessionRootPath: ROOT, activeWorkspacePath: "a.ipynb" };
const reload = { kind: "reload-document", path: "a.ipynb" } as const;
const ignore = { kind: "ignore", reason: "not-active-file" } as const;

describe("SN-400 follow decisions", () => {
  it("follows a Companion write to another file in the live root, with its cell", () => {
    expect(deepWorkFollowFromSourceEvent({ ...base, refreshDecision: ignore }, { rootPath: "c:\\work\\lerobot\\", path: "new/b.ipynb", cellId: "c1", cellIndex: 2 }))
      .toEqual({ path: "new/b.ipynb", cellId: "c1", cellIndex: 2 });
    // A freshly created file has no cell yet.
    expect(deepWorkFollowFromSourceEvent({ ...base, refreshDecision: ignore }, { rootPath: ROOT, path: "b.ipynb" }))
      .toEqual({ path: "b.ipynb", cellId: null, cellIndex: null });
  });

  it("reveals a cell in the focused file only after its in-place reload went ahead", () => {
    expect(deepWorkFollowFromSourceEvent({ ...base, refreshDecision: reload }, { rootPath: ROOT, path: "a.ipynb", cellIndex: 4 }))
      .toEqual({ path: "a.ipynb", cellId: null, cellIndex: 4 });
    expect(deepWorkFollowFromSourceEvent({ ...base, refreshDecision: { kind: "blocked-dirty", path: "a.ipynb" } }, { rootPath: ROOT, path: "a.ipynb", cellIndex: 4 })).toBeNull();
    expect(deepWorkFollowFromSourceEvent({ ...base, refreshDecision: reload }, { rootPath: ROOT, path: "a.ipynb" })).toBeNull();
  });

  it("does nothing when off, outside the root, unsafe, or for saved run output", () => {
    const event = { rootPath: ROOT, path: "b.ipynb", cellIndex: 0 };
    expect(deepWorkFollowFromSourceEvent({ ...base, followEnabled: false, refreshDecision: ignore }, event)).toBeNull();
    expect(deepWorkFollowFromSourceEvent({ ...base, deepWorkActive: false, refreshDecision: ignore }, event)).toBeNull();
    expect(deepWorkFollowFromSourceEvent({ ...base, refreshDecision: ignore }, { ...event, rootPath: "C:/Other" })).toBeNull();
    expect(deepWorkFollowFromSourceEvent({ ...base, refreshDecision: ignore }, { ...event, path: "../escape.ipynb" })).toBeNull();
    expect(deepWorkFollowFromSourceEvent({ ...base, refreshDecision: ignore }, { ...event, cellRunId: "run-1" })).toBeNull();
  });

  it("follows each run once, on its first update", () => {
    const followedRunIds = new Set<string>();
    const event = { rootPath: ROOT, path: "b.ipynb", run: { runId: "r1", cell: { cellId: "train", index: 3 } } };
    expect(deepWorkFollowFromRunEvent({ ...base, followedRunIds }, event)).toEqual({ path: "b.ipynb", cellId: "train", cellIndex: 3 });
    expect(deepWorkFollowFromRunEvent({ ...base, followedRunIds }, event)).toBeNull();
    expect(deepWorkFollowFromRunEvent({ ...base, followEnabled: false, followedRunIds: new Set() }, event)).toBeNull();
  });

  it("remembers the toggle, defaulting to on", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    expect(readDeepWorkFollowPreference(storage)).toBe(true);
    writeDeepWorkFollowPreference(storage, false);
    expect(readDeepWorkFollowPreference(storage)).toBe(false);
    writeDeepWorkFollowPreference(storage, true);
    expect(readDeepWorkFollowPreference(storage)).toBe(true);
  });
});

describe("SN-401 command list", () => {
  it("upserts running then finished without regressing, and bounds history", () => {
    const running = parseCompanionCommandEvent("t1", { command_id: "c", command: "ls", status: "running" }, 1)!;
    const done = parseCompanionCommandEvent("t1", { command_id: "c", command: "ls", status: "completed", exit_code: 0, output: "a" }, 5)!;
    let list = upsertCompanionCommand([], running);
    expect(countRunningCompanionCommands(list)).toBe(1);
    list = upsertCompanionCommand(list, done);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ status: "completed", exitCode: 0, output: "a", startedAt: 1, finishedAt: 5 });
    expect(upsertCompanionCommand(list, running)).toBe(list);
    let many = list;
    for (let i = 0; i < 5; i += 1) many = upsertCompanionCommand(many, parseCompanionCommandEvent("t2", { command_id: `x${i}`, command: "echo", status: "running" })!, 3);
    expect(many.map((entry) => entry.key)).toEqual(["t2:x2", "t2:x3", "t2:x4"]);
    expect(parseCompanionCommandEvent("t1", { command_id: "c", command: " ", status: "running" })).toBeNull();
    expect(parseCompanionCommandEvent("t1", { command_id: "c", command: "ls", status: "weird" })).toBeNull();
  });
});

const HOST = "smart-notes-jupyter-host";
const FRAME = "smart-notes-jupyter-focus";

function fakeLab() {
  const docs: Record<string, any> = {};
  const makeDoc = (path: string, ids: string[]) => {
    const model = { dirty: false };
    const widgets = ids.map((id) => ({ model: { id, type: "code", sharedModel: { getSource: () => id }, toJSON: () => ({ id, cell_type: "code", source: id, metadata: {}, outputs: [], execution_count: null }) } }));
    const content = {
      node: window.document.createElement("div"),
      outerNode: window.document.createElement("div"),
      activeCellIndex: 0,
      widgets,
      get activeCell() { return widgets[this.activeCellIndex] ?? null; },
      scrollToItem: jest.fn(async () => undefined),
    };
    const context = { path, model, ready: Promise.resolve(), revert: jest.fn(async () => undefined) };
    docs[path] = { content, context, revealed: Promise.resolve() };
    return docs[path];
  };
  makeDoc("a.ipynb", ["a0", "a1"]);
  makeDoc("b.ipynb", ["b0", "b1", "b2"]);
  const shell = { currentWidget: docs["a.ipynb"], currentPath: "a.ipynb" };
  const commands = {
    hasCommand: () => true,
    execute: jest.fn(async (id: string, args?: { path?: string }) => {
      if (id === "docmanager:open" && args?.path && docs[args.path]) {
        shell.currentWidget = docs[args.path];
        shell.currentPath = args.path;
        return docs[args.path];
      }
      return undefined;
    }),
  };
  return { app: { shell, commands, restored: Promise.resolve() }, docs, shell, commands };
}

describe("SN-400 bridge follow-companion", () => {
  let posted: Array<Record<string, any>>;
  let lab: ReturnType<typeof fakeLab>;
  const settle = async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 10)); };
  const send = (message: Record<string, unknown>) => window.dispatchEvent(new MessageEvent("message", {
    data: { source: HOST, version: 2, ...message }, origin: window.location.origin, source: window,
  }));
  const results = () => posted.filter((entry) => entry.source === FRAME && entry.kind === "follow-result");

  beforeEach(async () => {
    posted = [];
    jest.spyOn(window, "postMessage").mockImplementation(((data: Record<string, any>) => { posted.push(data); }) as typeof window.postMessage);
    lab = fakeLab();
    (window as unknown as Record<string, unknown>).jupyterapp = lab.app;
    new Function(JUPYTER_FOCUS_BRIDGE_SOURCE)();
    await settle();
  });

  afterEach(() => {
    window.dispatchEvent(new Event("pagehide"));
    delete (window as unknown as Record<string, unknown>).jupyterapp;
    jest.restoreAllMocks();
  });

  it("opens the Companion file in place and reveals the cell by id", async () => {
    send({ kind: "follow-companion", path: "b.ipynb", cellId: "b2", cellIndex: null });
    await settle();
    expect(lab.commands.execute).toHaveBeenCalledWith("docmanager:open", { path: "b.ipynb" });
    expect(lab.shell.currentPath).toBe("b.ipynb");
    expect(lab.docs["b.ipynb"].content.activeCellIndex).toBe(2);
    expect(lab.docs["b.ipynb"].content.scrollToItem).toHaveBeenCalledWith(2, "center");
    expect(results().pop()).toMatchObject({ path: "b.ipynb", blocked: false, reason: null });
  });

  it("stays put when the current document has unsaved cell edits, until the owner forces it", async () => {
    // A real owner cell edit (Lab metadata-only dirtiness is not owner work, SN-381).
    const edited = lab.docs["a.ipynb"].content.widgets[0].model;
    edited.toJSON = () => ({ id: "a0", cell_type: "code", source: "a0 # owner edit", metadata: {}, outputs: [], execution_count: null });
    lab.docs["a.ipynb"].context.model.dirty = true;
    send({ kind: "follow-companion", path: "b.ipynb", cellIndex: 1 });
    await settle();
    expect(lab.shell.currentPath).toBe("a.ipynb");
    expect(lab.commands.execute).not.toHaveBeenCalledWith("docmanager:open", expect.anything());
    expect(results().pop()).toMatchObject({ path: "b.ipynb", blocked: true, cellIndex: 1 });
    expect(results().at(-1)?.reason).toContain("unsaved edits");

    send({ kind: "follow-companion", path: "b.ipynb", cellIndex: 1, force: true });
    await settle();
    expect(lab.shell.currentPath).toBe("b.ipynb");
    expect(lab.docs["b.ipynb"].content.activeCellIndex).toBe(1);
  });

  it("reveals a cell in the focused file without reopening it, and rejects unsafe paths", async () => {
    send({ kind: "follow-companion", path: "a.ipynb", cellIndex: 9 });
    await settle();
    expect(lab.commands.execute).not.toHaveBeenCalled();
    expect(lab.docs["a.ipynb"].content.activeCellIndex).toBe(1);
    send({ kind: "follow-companion", path: "../x.ipynb", cellIndex: 0 });
    await settle();
    expect(lab.commands.execute).not.toHaveBeenCalled();
  });
});
