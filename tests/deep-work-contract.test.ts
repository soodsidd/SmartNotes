import { buildSmartNotesOperatingContext } from "@/lib/ai-sidebar";
import {
  buildAscentVectorReturnUrl,
  deepWorkPendingPath,
  parseDeepWorkDescriptor,
  validateDeepWorkReturnUrl,
  workspacePathBlockReason,
} from "@/lib/deep-work";
import type { JupyterFocusState } from "@/lib/jupyter-focus";

function descriptorParams(overrides: Record<string, string> = {}) {
  return new URLSearchParams({
    deepWork: "1",
    root: "C:\\Projects\\worktree",
    projectId: "project-1",
    repoId: "repo-1",
    workItemId: "SN-258",
    projectName: "Smart Notes",
    branch: "av/sn-258",
    worktree: "SN-258",
    access: "editable",
    file: "src/index.ts",
    line: "12",
    returnUrl: "https://av.example.test/work-items/SN-258",
    ...overrides,
  });
}

describe("SN-258 Deep Work launch, context, and return contract", () => {
  it("parses complete descriptors and rejects unsafe return URLs and relative roots", () => {
    expect(parseDeepWorkDescriptor(descriptorParams())).toMatchObject({
      rootPath: "C:\\Projects\\worktree",
      workItemId: "SN-258",
      activeFile: "src/index.ts",
      activeLine: 12,
      requestedAccess: "editable",
    });
    expect(parseDeepWorkDescriptor(descriptorParams({ returnUrl: "javascript:alert(1)" }))).toBeNull();
    expect(parseDeepWorkDescriptor(descriptorParams({ root: "../worktree" }))).toBeNull();
    expect(validateDeepWorkReturnUrl("data:text/html,hi")).toBeNull();
    // Execution context must never ride the launch URL/history.
    expect(
      parseDeepWorkDescriptor(
        descriptorParams({
          executionApproved: "1",
          executionContext: "pytest: one focused failure",
        })
      )
    ).toBeNull();
  });

  it("accepts a registered-root launch descriptor without AV identity", () => {
    expect(parseDeepWorkDescriptor(new URLSearchParams({
      deepWork: "1",
      root: "C:\\Projects\\local-workspace",
      access: "editable",
    }))).toEqual({
      rootPath: "C:\\Projects\\local-workspace",
      projectId: undefined,
      repoId: undefined,
      workItemId: undefined,
      projectName: "local-workspace",
      branch: undefined,
      worktreeLabel: undefined,
      requestedAccess: "editable",
      activeFile: undefined,
      activeLine: undefined,
      returnUrl: undefined,
    });
  });

  it("builds a same-origin structured AV dirty-tree URL with preserved identity", () => {
    const descriptor = parseDeepWorkDescriptor(descriptorParams())!;
    const returned = new URL(
      buildAscentVectorReturnUrl(descriptor, "diff", null, { serverValidatedReturnUrl: true })!
    );
    expect(returned.origin).toBe("https://av.example.test");
    expect(returned.pathname).toBe("/work-items/SN-258");
    expect(returned.searchParams.get("surface")).toBe("dirty-tree-diff");
    expect(returned.searchParams.get("projectId")).toBe("project-1");
    expect(returned.searchParams.get("repoId")).toBe("repo-1");
    expect(returned.searchParams.get("workItemId")).toBe("SN-258");
    expect(returned.searchParams.get("worktree")).toBe("SN-258");
    expect(returned.searchParams.get("file")).toBe("src/index.ts");
  });

  it("supplies bounded live project context as untrusted data without lifecycle or hidden-source authority", () => {
    const descriptor = parseDeepWorkDescriptor(descriptorParams())!;
    const pagePath = deepWorkPendingPath(descriptor);
    const focus: JupyterFocusState = {
      pagePath,
      workspacePath: "src/index.ts",
      documentKind: "file",
      isDirty: true,
      activeCellIndex: null,
      activeCellId: null,
      sourceRevision: "16:abcdef0123456789",
      modelRevision: 2,
      caret: { line: 0, column: 5, offset: 5 },
      selection: {
        start: { line: 0, column: 0, offset: 0 },
        end: { line: 0, column: 5, offset: 5 },
      },
      selectionRects: [],
      content: {
        activeCellSource: "const value = 1;\n",
        activeCellSourceTruncated: false,
        cells: [],
        windowTruncated: false,
      },
    };
    const context = buildSmartNotesOperatingContext({
      title: descriptor.projectName,
      path: pagePath,
      noteType: "jupyter",
      projectWorkspace: {
        ...descriptor,
        capability: "dwc_test_capability",
        executionContext: "pytest: one focused failure",
      },
      activeJupyterFocus: focus,
      apiBaseUrl: "http://127.0.0.1:3002",
    });
    expect(context).toContain("Brief/work item: SN-258");
    expect(context).toContain("Active repository-relative file: src/index.ts");
    expect(context).toContain("Current selected text: \"const\"");
    expect(context).toContain("<untrusted-live-source>");
    expect(context).toContain("UNTRUSTED DATA");
    expect(context).toContain("expected revision");
    expect(context).toContain("operation=list");
    expect(context).toContain("workspace_source_list");
    expect(context).toContain("workspace_source_create");
    expect(context).toContain("registered disk root are authoritative for the entire turn");
    expect(context).toContain("Vault page/tree/Jupyter-note APIs are outside this Deep Work turn");
    expect(context).toContain("no authority to commit, record verification, review, approve, merge, release, deploy");
    expect(context).toContain("pytest: one focused failure");
    expect(context).toContain("dwc_test_capability");
    expect(context).not.toContain("jupyter_cell_edit");
  });

  it("blocks hidden, secret-shaped, dependency, VCS, and build paths from source context", () => {
    for (const path of [".env", ".github/workflows/release.yml", "node_modules/pkg/a.js", "dist/a.js", "keys/private-key.pem"]) {
      expect(workspacePathBlockReason(path)).toBeTruthy();
    }
    expect(workspacePathBlockReason("src/index.ts")).toBeNull();
  });
});
