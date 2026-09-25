import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { VaultError } from "@/server/vault/errors";
import { resolveAccessMode, resolveProjectWorkspace } from "@/server/jupyter/workspace-root";

async function withWorkspace(
  run: (ctx: { workspace: string }) => Promise<void>
): Promise<void> {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "smart-notes-workspace-"));
  try {
    await run({ workspace });
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
}

describe("resolveAccessMode (SN-256)", () => {
  it("forces read-only on the default branch even when editable is requested", () => {
    expect(resolveAccessMode({ branch: "main", requestedAccess: "editable" })).toBe("read-only");
    expect(resolveAccessMode({ branch: "master", requestedAccess: "editable" })).toBe("read-only");
    expect(resolveAccessMode({ isDefaultBranch: true, requestedAccess: "editable" })).toBe("read-only");
  });

  it("defaults a non-default branch to read-only unless editable is explicitly requested", () => {
    expect(resolveAccessMode({ branch: "av/sn-256-feature" })).toBe("read-only");
    expect(resolveAccessMode({ branch: "av/sn-256-feature", requestedAccess: "editable" })).toBe("editable");
  });

  // Planner review (cycle 1): both bypasses below let a caller spoof editable
  // access to a default-branch (main/master) worktree despite the policy
  // stated above. `??` only falls through on null/undefined, so an explicit
  // `isDefaultBranch: false` used to short-circuit past the branch-name
  // check entirely, and an omitted branch/isDefaultBranch pair used to fall
  // through to editable because there was no default name to match against.
  it("SN-256 review fix: a default branch name wins even over a forged isDefaultBranch: false", () => {
    expect(resolveAccessMode({ branch: "main", isDefaultBranch: false, requestedAccess: "editable" })).toBe(
      "read-only"
    );
    expect(resolveAccessMode({ branch: "master", isDefaultBranch: false, requestedAccess: "editable" })).toBe(
      "read-only"
    );
    expect(resolveAccessMode({ branch: "Main", isDefaultBranch: false, requestedAccess: "editable" })).toBe(
      "read-only"
    );
  });

  it("SN-256 review fix: omitting branch/isDefaultBranch never defaults to editable", () => {
    expect(resolveAccessMode({ requestedAccess: "editable" })).toBe("read-only");
    expect(resolveAccessMode({ branch: "", requestedAccess: "editable" })).toBe("read-only");
    expect(resolveAccessMode({ branch: "   ", requestedAccess: "editable" })).toBe("read-only");
  });

  it("allows an explicit owner folder open to be editable without AV branch metadata", () => {
    expect(resolveAccessMode({ ownerOpen: true, requestedAccess: "editable" })).toBe("editable");
  });

  it("requires explicit owner confirmation before editing a default branch", () => {
    expect(resolveAccessMode({ ownerOpen: true, branch: "main", requestedAccess: "editable" })).toBe("read-only");
    expect(resolveAccessMode({
      ownerOpen: true,
      branch: "main",
      requestedAccess: "editable",
      defaultBranchEditConfirmed: true,
    })).toBe("editable");
  });
});

describe("resolveProjectWorkspace (SN-256)", () => {
  it("opens any existing absolute folder without a registered parent allowlist", async () => {
    await withWorkspace(async ({ workspace }) => {
      await expect(resolveProjectWorkspace({
        rootPath: workspace,
        branch: "feature/unregistered-folder",
        requestedAccess: "editable",
      })).resolves.toMatchObject({
        realRoot: await fs.realpath(workspace),
        accessMode: "editable",
      });
    });
  });

  it("rejects a relative rootPath", async () => {
    await expect(resolveProjectWorkspace({ rootPath: "relative/path" })).rejects.toMatchObject({
      code: "INVALID_PATH",
    });
  });

  it("opens an explicit workspace without copying anything", async () => {
    await withWorkspace(async ({ workspace }) => {
      await fs.writeFile(path.join(workspace, "existing-source.py"), "print('hi')\n", "utf8");

      const resolved = await resolveProjectWorkspace({
        rootPath: workspace,
        branch: "av/sn-256-feature",
        requestedAccess: "editable",
        projectId: "proj-1",
        repoId: "repo-1",
      });

      expect(path.resolve(resolved.realRoot)).toBe(path.resolve(workspace));
      expect(resolved.accessMode).toBe("editable");
      expect(resolved.key).toContain("project:");
      // No copy: the file we wrote directly in the worktree must still be the only copy.
      const entries = await fs.readdir(workspace);
      expect(entries).toEqual(["existing-source.py"]);
    });
  });

  it("does not require a canonical notebook.ipynb to exist", async () => {
    await withWorkspace(async ({ workspace }) => {
      await expect(
        resolveProjectWorkspace({ rootPath: workspace, branch: "feature/x", requestedAccess: "editable" })
      ).resolves.toMatchObject({ accessMode: "editable" });
    });
  });

  it("detects a local Git branch and preserves the default-branch lock until the owner unlocks it", async () => {
    await withWorkspace(async ({ workspace }) => {
      await fs.mkdir(path.join(workspace, ".git"), { recursive: true });
      await fs.writeFile(path.join(workspace, ".git", "HEAD"), "ref: refs/heads/main\n", "utf8");

      await expect(resolveProjectWorkspace({
        rootPath: workspace,
        ownerOpen: true,
        requestedAccess: "editable",
      })).resolves.toMatchObject({ branch: "main", accessMode: "read-only" });

      await expect(resolveProjectWorkspace({
        rootPath: workspace,
        ownerOpen: true,
        requestedAccess: "editable",
        defaultBranchEditConfirmed: true,
      })).resolves.toMatchObject({ branch: "main", accessMode: "editable" });
    });
  });

  it("rejects a nonexistent absolute path", async () => {
    await withWorkspace(async ({ workspace }) => {
      await expect(
        resolveProjectWorkspace({ rootPath: path.join(workspace, "does-not-exist") })
      ).rejects.toMatchObject({ code: "WORKSPACE_ROOT_MISSING" });
    });
  });

  it("opens the selected directory itself as the workspace root", async () => {
    await withWorkspace(async ({ workspace }) => {
      await expect(resolveProjectWorkspace({ rootPath: workspace })).resolves.toMatchObject({
        realRoot: await fs.realpath(workspace),
      });
    });
  });

  it("rejects a selected root that is a symlink or junction", async () => {
    await withWorkspace(async ({ workspace: parent }) => {
      const outside = await fs.mkdtemp(path.join(os.tmpdir(), "smart-notes-outside-"));
      const worktree = path.join(outside, "actual-worktree");
      await fs.mkdir(worktree, { recursive: true });
      const junctionPath = path.join(parent, "escape-hatch");
      await fs.symlink(worktree, junctionPath, "junction");

      try {
        await expect(resolveProjectWorkspace({ rootPath: junctionPath })).rejects.toMatchObject({
          code: "WORKSPACE_SYMLINK_ESCAPE",
        });
      } finally {
        await fs.rm(outside, { recursive: true, force: true });
      }
    });
  });

  it("defaults an explicit workspace branch's requestedAccess to read-only", async () => {
    await withWorkspace(async ({ workspace }) => {
      const resolved = await resolveProjectWorkspace({ rootPath: workspace, branch: "feature/y" });
      expect(resolved.accessMode).toBe("read-only");
    });
  });

  it("re-exports VaultError-shaped failures with a stable code", async () => {
    const error = await resolveProjectWorkspace({ rootPath: "" }).catch((e) => e);
    expect(error).toBeInstanceOf(VaultError);
    expect((error as VaultError).code).toBe("INVALID_PATH");
  });
});
