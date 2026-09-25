import {
  hasUnsavedLocalDraftChanges,
  isDeepWorkShellDraftPath,
  shouldBlockPendingPageReload,
} from "@/lib/page-reload";

describe("SN-263 Deep Work pending-reload gate", () => {
  it("recognizes synthetic Deep Work shell draft paths", () => {
    expect(isDeepWorkShellDraftPath("deep-work-pending:abc")).toBe(true);
    expect(isDeepWorkShellDraftPath("AI/Robotic Arm/master-repo.jupyter")).toBe(false);
    expect(isDeepWorkShellDraftPath(null)).toBe(false);
  });

  it("never treats a Deep Work draft as unsaved vault edits", () => {
    const draft = {
      path: "deep-work-pending:C%3A%5CProjects%5CLeRobot",
      title: "LeRobot",
      content: "",
    };
    expect(hasUnsavedLocalDraftChanges(draft, null)).toBe(false);
    expect(hasUnsavedLocalDraftChanges(draft, undefined)).toBe(false);
    expect(
      shouldBlockPendingPageReload({
        draft,
        pendingPath: draft.path,
        lastSavedSnapshot: null,
      })
    ).toBe(false);
  });

  it("still detects unsaved changes for ordinary vault pages", () => {
    const draft = {
      path: "AI/Robotic Arm/master-repo",
      title: "Master Repo",
      content: "<p>local</p>",
    };
    expect(hasUnsavedLocalDraftChanges(draft, null)).toBe(true);
    expect(
      hasUnsavedLocalDraftChanges(
        draft,
        JSON.stringify({ path: draft.path, title: draft.title, content: draft.content })
      )
    ).toBe(false);
  });
});
