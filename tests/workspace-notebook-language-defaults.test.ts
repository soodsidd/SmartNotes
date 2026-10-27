// Companion-created Deep Work notebooks must open with syntax highlighting:
// a skeleton without kernelspec/language_info renders as plain text in Lab.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createWorkspaceSource } from "@/server/jupyter/workspace-files";

const EMPTY = JSON.stringify({ cells: [], metadata: {}, nbformat: 4, nbformat_minor: 5 });
const LEROBOT_META = {
  kernelspec: { display_name: "Python (lerobot)", language: "python", name: "lerobot" },
  language_info: { name: "python", mimetype: "text/x-python", codemirror_mode: { name: "ipython", version: 3 }, version: "3.12.2" },
};

describe("workspace notebook creation language defaults", () => {
  let parent: string;
  let root: string;
  const request = () => ({ rootPath: root, projectName: "LeRobot", ownerOpen: true, requestedAccess: "editable" as const });

  beforeEach(async () => {
    parent = await fs.mkdtemp(path.join(os.tmpdir(), "nb-lang-"));
    root = path.join(parent, "LeRobot");
    await fs.mkdir(path.join(root, "sub"), { recursive: true });
  });
  afterEach(async () => {
    delete (global as Record<string, unknown>)["_smartNotesIo"];
    await fs.rm(parent, { recursive: true, force: true });
  });

  const metadataOf = async (relative: string) => JSON.parse(await fs.readFile(path.join(root, relative), "utf8")).metadata;

  it("borrows kernelspec and language_info from a sibling notebook", async () => {
    await fs.writeFile(path.join(root, "SO101.ipynb"), JSON.stringify({ cells: [], metadata: LEROBOT_META, nbformat: 4, nbformat_minor: 5 }));
    const created = await createWorkspaceSource(request(), "recording_review.ipynb", EMPTY);
    expect(await metadataOf("recording_review.ipynb")).toEqual(LEROBOT_META);
    // The returned source/revision describe what was actually written.
    expect(JSON.parse(created.source).metadata).toEqual(LEROBOT_META);
  });

  it("falls back to the workspace root, then to Python language info without a kernel", async () => {
    await fs.writeFile(path.join(root, "root.ipynb"), JSON.stringify({ cells: [], metadata: LEROBOT_META, nbformat: 4, nbformat_minor: 5 }));
    await createWorkspaceSource(request(), "sub/a.ipynb", EMPTY);
    expect(await metadataOf("sub/a.ipynb")).toEqual(LEROBOT_META);

    await fs.rm(path.join(root, "root.ipynb"));
    await fs.mkdir(path.join(root, "fresh"));
    await createWorkspaceSource(request(), "fresh/b.ipynb", EMPTY);
    const fallback = await metadataOf("fresh/b.ipynb");
    expect(fallback.kernelspec).toBeUndefined();
    expect(fallback.language_info).toMatchObject({ name: "python", mimetype: "text/x-python", codemirror_mode: { name: "ipython", version: 3 } });
  });

  it("keeps explicit metadata and leaves non-notebook files alone", async () => {
    await fs.writeFile(path.join(root, "SO101.ipynb"), JSON.stringify({ cells: [], metadata: LEROBOT_META, nbformat: 4, nbformat_minor: 5 }));
    const own = { kernelspec: { name: "julia", display_name: "Julia" }, language_info: { name: "julia" } };
    const source = JSON.stringify({ cells: [], metadata: own, nbformat: 4, nbformat_minor: 5 });
    const created = await createWorkspaceSource(request(), "j.ipynb", source);
    expect(created.source).toBe(source);
    expect(await metadataOf("j.ipynb")).toEqual(own);

    const py = await createWorkspaceSource(request(), "main.py", "print('x')\n");
    expect(await fs.readFile(path.join(root, "main.py"), "utf8")).toBe("print('x')\n");
    expect(py.source).toBe("print('x')\n");
  });
});
