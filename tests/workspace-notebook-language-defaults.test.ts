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

  it("uses the same default despite a neighboring notebook with a different kernel", async () => {
    const julia = { kernelspec: { name: "julia", language: "julia" }, language_info: { name: "julia" } };
    await fs.writeFile(path.join(root, "SO101.ipynb"), JSON.stringify({ cells: [], metadata: julia, nbformat: 4, nbformat_minor: 5 }));
    const created = await createWorkspaceSource(request(), "recording_review.ipynb", EMPTY);
    expect(await metadataOf("recording_review.ipynb")).toMatchObject({ language_info: { name: "python", mimetype: "text/x-python" } });
    expect((await metadataOf("recording_review.ipynb")).kernelspec).toBeUndefined();
    expect(JSON.parse(created.source).metadata).toEqual(await metadataOf("recording_review.ipynb"));
  });

  it("uses the same default in subfolders", async () => {
    await fs.writeFile(path.join(root, "root.ipynb"), JSON.stringify({ cells: [], metadata: LEROBOT_META, nbformat: 4, nbformat_minor: 5 }));
    await createWorkspaceSource(request(), "sub/a.ipynb", EMPTY);
    const fallback = await metadataOf("sub/a.ipynb");
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
    const kernelOnly = { kernelspec: { name: "julia", language: "julia" } };
    const kernelSource = JSON.stringify({ cells: [], metadata: kernelOnly, nbformat: 4, nbformat_minor: 5 });
    expect((await createWorkspaceSource(request(), "kernel.ipynb", kernelSource)).source).toBe(kernelSource);

    const py = await createWorkspaceSource(request(), "main.py", "print('x')\n");
    expect(await fs.readFile(path.join(root, "main.py"), "utf8")).toBe("print('x')\n");
    expect(py.source).toBe("print('x')\n");
  });
});
