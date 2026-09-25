/** @jest-environment jsdom */

import * as React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react";

jest.mock("@/lib/api/jupyter", () => ({
  launchJupyterSession: jest.fn(async () => ({
    status: "ready",
    pagePath: "Notebook/Section/analysis.html",
    url: "/api/jupyter/proxy/session-1/lab/tree/notebook.ipynb?token=test",
  })),
  launchJupyterWorkspaceSession: jest.fn(async () => ({
    status: "ready",
    pagePath: "C:/Projects/worktree",
    rootPath: "C:/Projects/worktree",
    branch: "av/sn-257",
    accessMode: "editable",
    url: "/api/jupyter/proxy/session-2/lab?token=test",
  })),
  stopJupyterWorkspaceSession: jest.fn(async () => ({ stopped: true })),
  // SN-247: fast-lane warm/close is fire-and-forget from this component; the
  // mock only needs to exist so the effect that calls it doesn't throw.
  warmJupyterFastLaneSession: jest.fn(),
  closeJupyterFastLaneSession: jest.fn(),
}));

import { JupyterNotebookView } from "@/components/jupyter-notebook-view";
import type { JupyterNotebookBridgeController } from "@/components/jupyter-notebook-view";
import { buildSmartNotesOperatingContext } from "@/lib/ai-sidebar";
import { launchJupyterWorkspaceSession } from "@/lib/api/jupyter";
import {
  JUPYTER_FOCUS_MESSAGE_SOURCE,
  createJupyterCommandMessage,
  jupyterFocusForPage,
  normalizeJupyterWorkspacePath,
  parseJupyterFocusMessage,
  parseJupyterCommandResult,
  type JupyterFocusState,
} from "@/lib/jupyter-focus";

const PAGE_PATH = "Notebook/Section/analysis.html";

function bridgeMessage(overrides: Record<string, unknown> = {}) {
  return {
    source: JUPYTER_FOCUS_MESSAGE_SOURCE,
    version: 2,
    kind: "focus",
    focus: {
      workspacePath: "src/analysis.ipynb",
      documentKind: "notebook",
      isDirty: false,
      activeCellIndex: 3,
      activeCellId: "cell-stable-3",
      sourceRevision: "12:abcdef0101234567",
      modelRevision: 0,
      caret: { line: 4, column: 7, offset: 42 },
      selection: {
        start: { line: 4, column: 2, offset: 37 },
        end: { line: 4, column: 7, offset: 42 },
      },
      selectionRects: [],
      content: null,
      ...overrides,
    },
  };
}

describe("live Jupyter focus context (SN-217)", () => {
  it("normalizes the relative workspace path and active cell/editor location", () => {
    expect(normalizeJupyterWorkspacePath("./src\\analysis.ipynb")).toBe("src/analysis.ipynb");
    expect(normalizeJupyterWorkspacePath("C:\\vault\\analysis.ipynb")).toBeNull();
    expect(normalizeJupyterWorkspacePath("../outside.py")).toBeNull();

    expect(parseJupyterFocusMessage(bridgeMessage(), PAGE_PATH)).toEqual({
      pagePath: PAGE_PATH,
      workspacePath: "src/analysis.ipynb",
      documentKind: "notebook",
      isDirty: false,
      activeCellIndex: 3,
      activeCellId: "cell-stable-3",
      sourceRevision: "12:abcdef0101234567",
      modelRevision: 0,
      caret: { line: 4, column: 7, offset: 42 },
      selection: {
        start: { line: 4, column: 2, offset: 37 },
        end: { line: 4, column: 7, offset: 42 },
      },
      selectionRects: [],
      content: null,
    });
  });

  it("validates dirty state and the semantic command request/result contract", () => {
    expect(parseJupyterFocusMessage(bridgeMessage({ isDirty: true }), PAGE_PATH)).toMatchObject({ isDirty: true });
    expect(parseJupyterFocusMessage(bridgeMessage({ isDirty: "yes" }), PAGE_PATH)).toBeNull();
    expect(createJupyterCommandMessage("command-1", "run-cell")).toEqual({
      source: "smart-notes-jupyter-host",
      version: 2,
      kind: "command",
      requestId: "command-1",
      command: "run-cell",
    });
    expect(parseJupyterCommandResult({
      source: JUPYTER_FOCUS_MESSAGE_SOURCE,
      version: 2,
      kind: "command-result",
      result: { requestId: "command-1", command: "run-cell", ok: true, reason: null },
      focus: bridgeMessage().focus,
    }, PAGE_PATH)).toMatchObject({ requestId: "command-1", command: "run-cell", ok: true });
  });

  it("rejects malformed bridge envelopes and keeps unavailable values unknown", () => {
    expect(parseJupyterFocusMessage({ ...bridgeMessage(), source: "other-frame" }, PAGE_PATH)).toBeNull();
    expect(parseJupyterFocusMessage(bridgeMessage({
      activeCellIndex: -1,
      activeCellId: "",
      caret: { line: -1, column: 0, offset: 0 },
      selection: null,
    }), PAGE_PATH)).toMatchObject({
      activeCellIndex: null,
      activeCellId: null,
      caret: null,
      selection: null,
    });
  });

  it("assembles focused file, cell, caret, selection, and targeted mutation guidance", () => {
    const focus = parseJupyterFocusMessage(bridgeMessage({ workspacePath: "notebook.ipynb" }), PAGE_PATH)!;
    const context = buildSmartNotesOperatingContext({
      title: "Analysis",
      path: PAGE_PATH,
      noteType: "jupyter",
      activeJupyterFocus: focus,
    });

    expect(context).toContain("workspaceFile (relative to this note's .jupyter folder): notebook.ipynb");
    expect(context).toContain("activeCell: index=3 (zero-based), id=cell-stable-3");
    expect(context).toContain("caret: line=4, column=7, offset=42 (all zero-based)");
    expect(context).toContain("start(line=4, column=2, offset=37 (all zero-based))");
    expect(context).toContain("Default references such as ‘this file’, ‘this cell’, and ‘here’ to the live focus above");
    expect(context).toContain('"tool": "jupyter_notebook_context"');
    expect(context).toContain('"index": 3, "cellId": "cell-stable-3"');
    expect(context).toContain('"tool": "jupyter_cell_edit"');
    expect(context).toContain("server rejects the edit if a reorder made them disagree");
    expect(context).toContain("Smart Notes Reload/Refresh button");
    expect(context).toContain("Existing jupyter_* tools remain the only notebook mutation path");
    expect(context).toContain("still target this note's notebook.ipynb");
  });

  it("updates to a different focused workspace file without inventing a notebook cell", () => {
    const focus = parseJupyterFocusMessage(bridgeMessage({
      workspacePath: "helpers/model.py",
      documentKind: "file",
      activeCellIndex: null,
      activeCellId: null,
      caret: { line: 11, column: 5, offset: 180 },
      selection: {
        start: { line: 11, column: 1, offset: 176 },
        end: { line: 11, column: 5, offset: 180 },
      },
    }), PAGE_PATH)!;
    const context = buildSmartNotesOperatingContext({
      title: "Analysis",
      path: PAGE_PATH,
      noteType: "jupyter",
      activeJupyterFocus: focus,
    });

    expect(context).toContain("workspaceFile (relative to this note's .jupyter folder): helpers/model.py");
    expect(context).toContain("documentKind: file");
    expect(context).toContain("activeCell: (unavailable — the focused JupyterLab document is not a notebook)");
    expect(context).toContain("caret: line=11, column=5, offset=180 (all zero-based)");
    expect(context).not.toContain("cell-stable-3");
  });

  it("states unknown explicitly after focus is cleared or belongs to a page that was left", () => {
    const focus = parseJupyterFocusMessage(bridgeMessage(), PAGE_PATH)!;
    expect(jupyterFocusForPage(focus, PAGE_PATH, "jupyter")).toBe(focus);
    expect(jupyterFocusForPage(focus, "Notebook/Section/other.html", "jupyter")).toBeNull();
    expect(jupyterFocusForPage(focus, PAGE_PATH, "text")).toBeNull();

    const context = buildSmartNotesOperatingContext({
      title: "Analysis",
      path: PAGE_PATH,
      noteType: "jupyter",
      activeJupyterFocus: null,
    });
    expect(context).toContain("workspaceFile (relative to this note's .jupyter folder): (unknown");
    expect(context).toContain("activeCell: (unknown");
    expect(context).toContain("caret: (unavailable");
    expect(context).not.toContain("src/analysis.ipynb");
  });

  it("accepts focus only from the mounted same-origin frame and clears it on leave", async () => {
    const onFocusChange = jest.fn<void, [JupyterFocusState | null]>();
    const view = render(
      <JupyterNotebookView pagePath={PAGE_PATH} title="Analysis" onFocusChange={onFocusChange} />
    );
    const frame = await waitFor(() => view.getByTestId("jupyter-frame") as HTMLIFrameElement);

    act(() => {
      window.dispatchEvent(new MessageEvent("message", {
        origin: window.location.origin,
        source: frame.contentWindow,
        data: bridgeMessage(),
      }));
    });
    expect(onFocusChange).toHaveBeenLastCalledWith(expect.objectContaining({
      pagePath: PAGE_PATH,
      workspacePath: "src/analysis.ipynb",
      activeCellIndex: 3,
    }));

    act(() => {
      window.dispatchEvent(new MessageEvent("message", {
        origin: "https://untrusted.example",
        source: frame.contentWindow,
        data: bridgeMessage({ workspacePath: "spoofed.py" }),
      }));
    });
    expect(onFocusChange).not.toHaveBeenCalledWith(expect.objectContaining({ workspacePath: "spoofed.py" }));

    view.unmount();
    expect(onFocusChange).toHaveBeenLastCalledWith(null);
  });

  it("forwards contextmenu to the host and exposes the answer application channel", async () => {
    const onContextMenu = jest.fn();
    let bridge: JupyterNotebookBridgeController | null = null;
    const view = render(
      <JupyterNotebookView
        pagePath={PAGE_PATH}
        title="Analysis"
        onContextMenu={onContextMenu}
        onBridgeReady={(value) => { bridge = value; }}
      />
    );
    const frame = await waitFor(() => view.getByTestId("jupyter-frame") as HTMLIFrameElement);
    const postMessage = jest.spyOn(frame.contentWindow!, "postMessage").mockImplementation(() => undefined);

    act(() => {
      window.dispatchEvent(new MessageEvent("message", {
        origin: window.location.origin,
        source: frame.contentWindow,
        data: {
          ...bridgeMessage(),
          kind: "contextmenu",
          contextmenu: { x: 32, y: 64 },
        },
      }));
    });
    expect(onContextMenu).toHaveBeenCalledWith(expect.objectContaining({
      pagePath: PAGE_PATH,
      x: 32,
      y: 64,
      focus: expect.objectContaining({ activeCellId: "cell-stable-3" }),
    }));

    expect(bridge).not.toBeNull();
    expect(bridge!.applyAnswer("replacement", undefined, "answer-1")).toBe("answer-1");
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      source: "smart-notes-jupyter-host",
      kind: "apply-answer",
      requestId: "answer-1",
      answer: "replacement",
    }), window.location.origin);
  });

  it("launches a project workspace and sends toolbar commands only to its authenticated frame", async () => {
    const workspace = {
      rootPath: "C:/Projects/worktree",
      projectName: "Smart Notes",
      branch: "av/sn-257",
      worktreeLabel: "SN-257",
      requestedAccess: "editable" as const,
      activeFile: "src/index.ts",
      activeLine: 12,
    };
    const view = render(
      <JupyterNotebookView
        pagePath={workspace.rootPath}
        title="Deep Work"
        workspace={workspace}
      />
    );
    const frame = await waitFor(() => view.getByTestId("jupyter-frame") as HTMLIFrameElement);
    expect(launchJupyterWorkspaceSession).toHaveBeenCalledWith(workspace);
    const postMessage = jest.spyOn(frame.contentWindow!, "postMessage").mockImplementation(() => undefined);
    fireEvent.load(frame);
    await waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      source: "smart-notes-jupyter-host",
      kind: "command",
      command: "focus-file",
      path: "src/index.ts",
      line: 12,
    }), window.location.origin));
    const focusCommand = postMessage.mock.calls.find(
      ([message]) => (message as { command?: string }).command === "focus-file"
    )?.[0] as { requestId: string };
    act(() => {
      window.dispatchEvent(new MessageEvent("message", {
        origin: window.location.origin,
        source: frame.contentWindow,
        data: {
          source: JUPYTER_FOCUS_MESSAGE_SOURCE,
          version: 2,
          kind: "command-result",
          result: { requestId: focusCommand.requestId, command: "focus-file", ok: true, reason: null },
          focus: bridgeMessage({ workspacePath: "src/index.ts", documentKind: "file" }).focus,
        },
      }));
    });

    act(() => {
      window.dispatchEvent(new MessageEvent("message", {
        origin: window.location.origin,
        source: frame.contentWindow,
        data: bridgeMessage({
          workspacePath: "src/index.ts",
          documentKind: "file",
          isDirty: true,
          activeCellIndex: null,
          activeCellId: null,
        }),
      }));
    });
    fireEvent.click(view.getByTestId("jupyter-toolbar-overflow"));
    fireEvent.click(view.getByText("Format document"));
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      source: "smart-notes-jupyter-host",
      kind: "command",
      command: "format-document",
    }), window.location.origin);
  });
});
