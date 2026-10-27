import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test, type Frame, type Page } from "@playwright/test";

// SN-400 real-JupyterLab smoke: a scratch Deep Work root is restored from the
// sticky record, then "Companion" writes go through the same capability-scoped
// workspace APIs the Companion bridge uses. With Follow on, the running Lab
// frame opens the written notebook and reveals the touched cell; with unsaved
// owner cell edits it stays put and offers Open instead.

const EVIDENCE = path.join(__dirname, "..", "evidence", "SN-400");

function notebook(sources: string[]) {
  return JSON.stringify({
    cells: sources.map((source, index) => ({ cell_type: "code", id: `seed-${index}`, metadata: {}, source, outputs: [], execution_count: null })),
    metadata: { kernelspec: { name: "python3", display_name: "Python 3", language: "python" } },
    nbformat: 4,
    nbformat_minor: 5,
  }, null, 1);
}

async function labFrame(page: Page): Promise<Frame> {
  await expect.poll(() => page.frames().some((frame) => /\/lab/.test(frame.url())), { timeout: 120_000 }).toBe(true);
  const frame = page.frames().find((candidate) => /\/lab/.test(candidate.url()))!;
  await frame.waitForFunction(() => Boolean((window as unknown as { jupyterapp?: { shell?: unknown } }).jupyterapp?.shell), undefined, { timeout: 120_000 });
  await frame.evaluate(() => (window as unknown as { jupyterapp: { restored: Promise<void> } }).jupyterapp.restored);
  await frame.waitForFunction(() => (window as unknown as { jupyterapp: any }).jupyterapp.commands.hasCommand("docmanager:open"), undefined, { timeout: 120_000 });
  return frame;
}

const labState = (frame: Frame) => frame.evaluate(() => {
  const app = (window as unknown as { jupyterapp: any }).jupyterapp;
  const widget = app.shell.currentWidget;
  return { path: widget?.context?.path ?? null, activeCellIndex: widget?.content?.activeCellIndex ?? null };
});

test.describe("SN-400 Follow Companion in real JupyterLab", () => {
  test.skip(({ isMobile }) => isMobile, "Desktop Deep Work smoke");
  test.setTimeout(300_000);

  let root: string;

  test.beforeAll(() => {
    fs.mkdirSync(EVIDENCE, { recursive: true });
    root = fs.mkdtempSync(path.join(os.tmpdir(), "sn400-root-"));
    fs.writeFileSync(path.join(root, "a.ipynb"), notebook(["print('owner notebook')", "x = 1"]));
    fs.writeFileSync(path.join(root, "c.ipynb"), notebook(["c0 = 0"]));
  });

  test.afterAll(() => {
    // The rooted Jupyter server may still hold the folder; leftover temp is harmless.
    try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ }
  });

  test("follows Companion into a new notebook and cell, and defers to unsaved owner edits", async ({ page, request }) => {
    await page.addInitScript((rootPath) => {
      window.localStorage.setItem("smart-notes-last-deep-work-workspace", JSON.stringify({
        version: 1, rootPath, projectName: "SN400 Scratch", requestedAccess: "editable", savedAt: Date.now(),
      }));
    }, root);

    const sessionResponse = page.waitForResponse(
      (response) => response.url().includes("/api/jupyter/workspace/session") && response.request().method() === "POST" && response.ok(),
      { timeout: 180_000 }
    );
    await page.goto("/");
    const session = await (await sessionResponse).json();
    const capability: string = session.capability ?? session.session?.capability;
    expect(capability).toMatch(/^dwc_/);

    const frame = await labFrame(page);
    await expect(page.getByTestId("jupyter-toolbar-follow-companion")).toHaveAttribute("aria-pressed", "true");

    // Owner opens a.ipynb first.
    await frame.evaluate(() => (window as unknown as { jupyterapp: any }).jupyterapp.commands.execute("docmanager:open", { path: "a.ipynb" }));
    await expect.poll(async () => (await labState(frame)).path, { timeout: 60_000 }).toBe("a.ipynb");

    // Companion creates b.ipynb and adds three cells.
    const created = await request.post("/api/workspace/source", {
      data: { workspace: capability, path: "b.ipynb", source: notebook([]) },
    });
    expect(created.status()).toBe(201);
    let revision = (await created.json()).revision as string;
    for (const source of ["import math", "y = math.pi", "print(y)"]) {
      const response = await request.post("/api/workspace/notebook", {
        data: { workspace: capability, path: "b.ipynb", expectedRevision: revision, operation: "cell_create", source },
      });
      expect(response.ok()).toBe(true);
      revision = (await response.json()).revision;
    }
    await expect.poll(async () => labState(frame), { timeout: 60_000 }).toEqual({ path: "b.ipynb", activeCellIndex: 2 });
    await page.screenshot({ path: path.join(EVIDENCE, "followed-new-notebook.png") });

    // Companion inserts a cell at the top of the same notebook: revealed in place.
    const top = await request.post("/api/workspace/notebook", {
      data: { workspace: capability, path: "b.ipynb", expectedRevision: revision, operation: "cell_create", source: "# header", index: 0 },
    });
    expect(top.ok()).toBe(true);
    await expect.poll(async () => labState(frame), { timeout: 60_000 }).toEqual({ path: "b.ipynb", activeCellIndex: 0 });

    // Owner makes an unsaved cell edit; Companion then edits c.ipynb.
    await frame.evaluate(() => {
      const content = (window as unknown as { jupyterapp: any }).jupyterapp.shell.currentWidget.content;
      content.widgets[1].model.sharedModel.setSource("import math  # owner edit");
    });
    const cRead = await request.get(`/api/workspace/notebook?workspace=${encodeURIComponent(capability)}&path=c.ipynb`);
    const cRevision = (await cRead.json()).revision as string;
    const cEdit = await request.post("/api/workspace/notebook", {
      data: { workspace: capability, path: "c.ipynb", expectedRevision: cRevision, operation: "cell_create", source: "c1 = 1" },
    });
    expect(cEdit.ok()).toBe(true);
    const notice = page.getByTestId("jupyter-follow-notice");
    await expect(notice).toContainText("unsaved edits", { timeout: 60_000 });
    expect((await labState(frame)).path).toBe("b.ipynb");
    await page.screenshot({ path: path.join(EVIDENCE, "blocked-by-owner-edits.png") });

    await page.getByTestId("jupyter-follow-open").click();
    await expect.poll(async () => labState(frame), { timeout: 60_000 }).toEqual({ path: "c.ipynb", activeCellIndex: 1 });
    await expect(notice).toHaveCount(0);
    await page.screenshot({ path: path.join(EVIDENCE, "opened-after-owner-choice.png") });

    // Follow off: Companion writes elsewhere no longer move the view.
    await page.getByTestId("jupyter-toolbar-follow-companion").click();
    await expect(page.getByTestId("jupyter-toolbar-follow-companion")).toHaveAttribute("aria-pressed", "false");
    const aRead = await request.get(`/api/workspace/notebook?workspace=${encodeURIComponent(capability)}&path=a.ipynb`);
    const aEdit = await request.post("/api/workspace/notebook", {
      data: { workspace: capability, path: "a.ipynb", expectedRevision: (await aRead.json()).revision, operation: "cell_create", source: "z = 3" },
    });
    expect(aEdit.ok()).toBe(true);
    await page.waitForTimeout(3_000);
    expect((await labState(frame)).path).toBe("c.ipynb");
  });
});
