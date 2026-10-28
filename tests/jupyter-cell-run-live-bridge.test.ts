/** @jest-environment jsdom */

// SN-381: the real injected JupyterLab bridge, driven against a minimal fake
// Lab notebook, proves how Companion run updates land in the open document:
// live output in the matching cell, an in-place reload only when nothing but
// that run's output is unsaved, and a visible notice instead of touching
// owner edits.

import { cellSourceRevision } from "@/lib/jupyter-cell-fingerprint";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { JUPYTER_FOCUS_BRIDGE_SOURCE } = require("../server/jupyter-focus-bridge");

const HOST = "smart-notes-jupyter-host";
const FRAME = "smart-notes-jupyter-focus";

type Output = Record<string, unknown>;

interface FakeCell {
  id: string;
  source: string;
  outputs: Output[];
  execution_count: number | null;
  type?: "code" | "markdown";
}

function fakeNotebook(path: string, disk: FakeCell[], metadata: Record<string, unknown> = {}) {
  const document = { dirty: false, getMetadata: (key: string) => metadata[key] };
  const build = (cells: FakeCell[]) =>
    cells.map((cell) => {
      const state = { ...cell, outputs: [...cell.outputs] };
      const sharedModel = {
        getSource: () => state.source,
        setSource: (value: string) => {
          state.source = value;
          document.dirty = true;
        },
        setOutputs: (outputs: Output[]) => {
          state.outputs = outputs;
          document.dirty = true;
        },
        transact: (fn: () => void) => fn(),
        get execution_count() {
          return state.execution_count;
        },
        set execution_count(value: number | null) {
          state.execution_count = value;
          document.dirty = true;
        },
      };
      const model = {
        id: state.id,
        type: state.type ?? "code",
        mimeType: "text/plain",
        executionState: "idle",
        sharedModel,
        toJSON: () => ({ id: state.id, cell_type: state.type ?? "code", source: state.source, metadata: {}, outputs: state.outputs, execution_count: state.execution_count }),
      };
      return { model, state };
    });
  let cells = build(disk);
  const node = window.document.createElement("div");
  const scroller = window.document.createElement("div");
  node.appendChild(scroller);
  const content = {
    node,
    outerNode: scroller,
    model: { cells: { forEach: (visit: (cell: { mimeType: string }) => void) => cells.forEach(({ model }) => visit(model)) } },
    activeCellIndex: 1,
    get activeCell() {
      return this.widgets[this.activeCellIndex] ?? null;
    },
    get widgets() {
      return cells.map(({ model }) => ({ model }));
    },
  };
  const context = {
    path,
    model: document,
    ready: Promise.resolve(),
    revert: jest.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      cells = build(disk);
      content.activeCellIndex = 0; // a reload resets Lab's active cell
      scroller.scrollTop = 0;
      document.dirty = false;
    }),
  };
  const widget = { content, context };
  const commands = {
    hasCommand: () => true,
    execute: jest.fn(async (id: string) => {
      if (id === "docmanager:reload") {
        await new Promise((resolve) => setTimeout(resolve, 20));
        await context.revert();
      }
    }),
  };
  const app = { shell: { currentWidget: widget, currentPath: path }, commands, restored: Promise.resolve() };
  return {
    app,
    context,
    content,
    scroller,
    document,
    cell: (index: number) => cells[index].state,
    model: (index: number) => cells[index].model,
    setDisk: (next: FakeCell[]) => {
      disk = next;
    },
  };
}

const CELLS: FakeCell[] = [
  { id: "setup", source: "import x", outputs: [], execution_count: 1 },
  { id: "train", source: "train()", outputs: [{ output_type: "stream", name: "stdout", text: "old\n" }], execution_count: 2 },
];

function run(overrides: Record<string, unknown> = {}) {
  return {
    runId: "run-1",
    status: "running",
    stillRunning: true,
    cell: { index: 1, cellId: "train", sourceRevision: cellSourceRevision("train()") },
    executionCount: null,
    stdout: { text: "epoch 1\n" },
    stderr: { text: "" },
    result: null,
    error: null,
    persistence: null,
    ...overrides,
  };
}

describe("SN-381 Companion cell runs in the open JupyterLab notebook", () => {
  let posted: Array<Record<string, any>>;
  let lab: ReturnType<typeof fakeNotebook>;

  async function settle() {
    for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
  }

  function send(message: Record<string, unknown>) {
    window.dispatchEvent(new MessageEvent("message", {
      data: { source: HOST, version: 2, ...message },
      origin: window.location.origin,
      source: window,
    }));
  }

  const notices = () => posted.filter((entry) => entry.source === FRAME && entry.kind === "cell-run-update-result");

  beforeEach(async () => {
    posted = [];
    jest.spyOn(window, "postMessage").mockImplementation(((data: Record<string, any>) => {
      posted.push(data);
    }) as typeof window.postMessage);
    lab = fakeNotebook("analysis.ipynb", CELLS);
    (window as unknown as Record<string, unknown>).jupyterapp = lab.app;
    new Function(JUPYTER_FOCUS_BRIDGE_SOURCE)();
    await settle();
  });

  afterEach(() => {
    window.dispatchEvent(new Event("pagehide"));
    delete (window as unknown as Record<string, unknown>).jupyterapp;
    jest.restoreAllMocks();
  });

  it("highlights metadata-less code without changing notebook metadata or overriding another kernel", async () => {
    expect(lab.model(0).mimeType).toBe("text/x-python");
    expect(lab.document.getMetadata("language_info")).toBeUndefined();
    window.dispatchEvent(new Event("pagehide"));
    lab = fakeNotebook("julia.ipynb", CELLS, { kernelspec: { name: "julia", language: "julia" } });
    (window as unknown as Record<string, unknown>).jupyterapp = lab.app;
    new Function(JUPYTER_FOCUS_BRIDGE_SOURCE)();
    await settle();
    expect(lab.model(0).mimeType).toBe("text/plain");
  });

  it("shows live output in the matching cell, then reloads saved outputs in place", async () => {
    lab.scroller.scrollTop = 480;
    send({ kind: "cell-run-update", path: "analysis.ipynb", run: run() });
    await settle();
    expect(lab.cell(1).outputs).toEqual([{ output_type: "stream", name: "stdout", text: "epoch 1\n" }]);
    expect(lab.cell(1).execution_count).toBeNull();
    expect(lab.model(1).executionState).toBe("running");
    expect(lab.cell(0)).toEqual({ ...CELLS[0], outputs: [] });

    // The server saved the outputs; disk now carries the full nbformat result.
    lab.setDisk([CELLS[0], { ...CELLS[1], execution_count: 3, outputs: [{ output_type: "display_data", data: { "image/png": "x" } }] }]);
    send({ kind: "cell-run-update", path: "analysis.ipynb", run: run({ status: "completed", stillRunning: false, executionCount: 3, persistence: { status: "saved" } }) });
    await settle();
    expect(lab.context.revert).toHaveBeenCalledTimes(1);
    expect(lab.app.commands.execute).not.toHaveBeenCalledWith("docmanager:reload");
    expect(lab.cell(1).outputs).toEqual([{ output_type: "display_data", data: { "image/png": "x" } }]);
    expect(lab.document.dirty).toBe(false);
    // Owner's place is kept across the reload.
    expect(lab.content.activeCellIndex).toBe(1);
    expect(lab.scroller.scrollTop).toBe(480);
    expect(notices().pop()?.reason ?? null).toBeNull();
  });

  it("never reloads over owner edits made during the run", async () => {
    send({ kind: "cell-run-update", path: "analysis.ipynb", run: run() });
    await settle();
    lab.model(0).sharedModel.setSource("import x  # owner edit");
    send({ kind: "cell-run-update", path: "analysis.ipynb", run: run({ status: "completed", stillRunning: false, executionCount: 3, persistence: { status: "saved" } }) });
    await settle();
    expect(lab.context.revert).not.toHaveBeenCalled();
    expect(lab.cell(0).source).toBe("import x  # owner edit");
    expect(lab.cell(1).execution_count).toBe(3);
    expect(notices().pop()?.reason).toContain("unsaved edits");
  });

  it("does not reload when the owner already had unsaved work before the run", async () => {
    lab.model(0).sharedModel.setSource("draft");
    send({ kind: "cell-run-update", path: "analysis.ipynb", run: run({ status: "completed", stillRunning: false, executionCount: 3, persistence: { status: "saved" } }) });
    await settle();
    expect(lab.context.revert).not.toHaveBeenCalled();
    expect(lab.cell(0).source).toBe("draft");
  });

  it("leaves a cell whose source changed alone and says the output is only in Companion", async () => {
    lab.model(1).sharedModel.setSource("train(epochs=2)");
    send({ kind: "cell-run-update", path: "analysis.ipynb", run: run() });
    await settle();
    expect(lab.cell(1).outputs).toEqual(CELLS[1].outputs);
    expect(notices().pop()?.reason).toContain("shown only in Companion");
  });

  it("surfaces a server save conflict with the output kept visible in the cell", async () => {
    send({ kind: "cell-run-update", path: "analysis.ipynb", run: run({
      status: "error",
      stillRunning: false,
      executionCount: 4,
      error: { ename: "ValueError", evalue: "bad", traceback: "Traceback\nValueError: bad" },
      persistence: { status: "conflict", message: "The cell's outputs were changed by another run during this one." },
    }) });
    await settle();
    expect(lab.context.revert).not.toHaveBeenCalled();
    expect(lab.cell(1).outputs).toEqual([
      { output_type: "stream", name: "stdout", text: "epoch 1\n" },
      { output_type: "error", ename: "ValueError", evalue: "bad", traceback: ["Traceback", "ValueError: bad"] },
    ]);
    expect(lab.model(1).executionState).toBe("idle");
    expect(notices().pop()?.reason).toMatch(/changed by another run.*save the notebook to keep it/);
  });

  it("ignores runs for a notebook that is not the focused document", async () => {
    send({ kind: "cell-run-update", path: "other.ipynb", run: run({ persistence: { status: "saved" }, stillRunning: false }) });
    await settle();
    expect(lab.cell(1)).toEqual(CELLS[1]);
    expect(lab.context.revert).not.toHaveBeenCalled();
    expect(notices()).toHaveLength(0);
  });

  it("applies a Companion edit's reload before the run that follows it", async () => {
    // Companion edits the cell (disk changes), then immediately runs it.
    lab.setDisk([CELLS[0], { ...CELLS[1], source: "train(epochs=2)" }]);
    send({ kind: "command", requestId: "r1", command: "reload-document", path: "analysis.ipynb" });
    send({ kind: "cell-run-update", path: "analysis.ipynb", run: run({ cell: { index: 1, cellId: "train", sourceRevision: cellSourceRevision("train(epochs=2)") } }) });
    await settle();
    expect(lab.cell(1).source).toBe("train(epochs=2)");
    expect(lab.cell(1).outputs).toEqual([{ output_type: "stream", name: "stdout", text: "epoch 1\n" }]);
    expect(notices().filter((entry) => entry.reason)).toHaveLength(0);
  });

  it("treats JupyterLab kernel-metadata dirtiness as reloadable, without the discard dialog", async () => {
    // Lab rewrites kernelspec/language_info on kernel connect: dirty, but no owner cell edit.
    lab.document.dirty = true;
    lab.setDisk([CELLS[0], { ...CELLS[1], source: "train(epochs=3)" }]);
    send({ kind: "command", requestId: "r2", command: "reload-document", path: "analysis.ipynb" });
    await settle();
    expect(lab.cell(1).source).toBe("train(epochs=3)");
    expect(lab.app.commands.execute).not.toHaveBeenCalledWith("docmanager:reload");
    const result = posted.filter((entry) => entry.kind === "command-result").pop();
    expect(result.result).toMatchObject({ requestId: "r2", ok: true });
    expect(result.focus.hasUnsavedCellEdits).toBe(false);
  });

  it("reports a real owner cell edit so the host and frame both refuse the reload", async () => {
    lab.model(0).sharedModel.setSource("owner draft");
    lab.setDisk([CELLS[0], { ...CELLS[1], source: "train(epochs=3)" }]);
    send({ kind: "command", requestId: "r3", command: "reload-document", path: "analysis.ipynb" });
    await settle();
    expect(lab.context.revert).not.toHaveBeenCalled();
    expect(lab.cell(0).source).toBe("owner draft");
    const result = posted.filter((entry) => entry.kind === "command-result").pop();
    expect(result.result).toMatchObject({ requestId: "r3", ok: false });
    expect(result.focus).toMatchObject({ isDirty: true, hasUnsavedCellEdits: true });
  });

  it("reloads saved run output even when only Lab metadata was dirty", async () => {
    lab.document.dirty = true;
    lab.setDisk([CELLS[0], { ...CELLS[1], execution_count: 3, outputs: [{ output_type: "stream", name: "stdout", text: "done\n" }] }]);
    send({ kind: "cell-run-update", path: "analysis.ipynb", run: run({ status: "completed", stillRunning: false, executionCount: 3, persistence: { status: "saved" } }) });
    await settle();
    expect(lab.context.revert).toHaveBeenCalledTimes(1);
    expect(lab.cell(1).outputs).toEqual([{ output_type: "stream", name: "stdout", text: "done\n" }]);
  });

  it("shares one source fingerprint with the server", () => {
    const match = /const sourceRevision = \(value\) => \{[\s\S]*?\n {2}\};/.exec(JUPYTER_FOCUS_BRIDGE_SOURCE);
    expect(match).not.toBeNull();
    const bridgeRevision = new Function(`${match![0]}; return sourceRevision;`)() as (value: string) => string;
    for (const text of ["", "train()", "print('é')\n# 🚀", "x = 1\r\ny = 2"]) {
      expect(bridgeRevision(text)).toBe(cellSourceRevision(text));
    }
  });
});
