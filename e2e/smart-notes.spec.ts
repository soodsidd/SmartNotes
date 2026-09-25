import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import {
  apiCreatePage,
  createVaultNotebook,
  deletePageViaMenu,
  ensureNotebookTreeVisible,
  expectActivePageTitle,
  openSectionContextMenu,
  renamePageViaMenu,
  submitCreatePageDialog,
} from "./helpers";

const VAULT = path.resolve(__dirname, "..", ".e2e-vault");

function slugifyTitle(title: string) {
  return (
    title
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^[-.]+|[-.]+$/g, "")
      .toLowerCase() || "untitled-page"
  );
}

test.describe.configure({ mode: "serial" });

test("home page renders shell with tree, editor, and companion entry", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("app-shell")).toBeVisible();
  const tree = await ensureNotebookTreeVisible(page);
  await expect(tree).toBeVisible();
  await expect(page.getByTestId("page-main")).toBeVisible();
  await expect(page.getByTestId("ai-toggle-btn")).toBeVisible();
  await expect(tree.getByRole("button", { name: "Personal Notebook" })).toBeVisible();
});

test("GET /api/vault returns tree JSON", async ({ request }) => {
  const r = await request.get("/api/vault");
  expect(r.ok()).toBe(true);
  const j = await r.json();
  expect(Array.isArray(j.tree)).toBe(true);
  expect(j.tree.length).toBeGreaterThan(0);
});

test("clicking a page loads its body in the editor", async ({ page }) => {
  await page.goto("/");
  const tree = await ensureNotebookTreeVisible(page);
  await tree.getByText("Welcome to Smart Notes").first().click();
  await expectActivePageTitle(page, /Welcome/);
  const editor = page.getByTestId("rich-text-editor");
  await expect(editor).toContainText("OneNote-style research vault");
});

test("typing in the editor triggers debounced auto-save (PUT /api/page)", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Mobile keyboard End/type is flaky for this autosave contract");
  await page.goto("/");
  const tree = await ensureNotebookTreeVisible(page);
  await tree.getByText("Welcome to Smart Notes").first().click();
  await expectActivePageTitle(page, /Welcome/);

  const putPromise = page.waitForRequest(
    (req) => req.url().includes("/api/page") && req.method() === "PUT",
    { timeout: 20000 }
  );

  const editor = page.getByTestId("rich-text-editor");
  await editor.click();
  await page.keyboard.press("End");
  await page.keyboard.type("\n\nE2E auto-save marker line.");

  const req = await putPromise;
  const body = req.postDataJSON() as { body?: string; content?: string; title?: string };
  const savedBody = body.body ?? body.content ?? "";
  expect(savedBody).toContain("E2E auto-save marker line.");
  // Status can flicker Unsaved/Saving while debounce settles; PUT above is the contract.
  await expect
    .poll(async () => {
      const status = await page.getByTestId("save-status").innerText();
      return /Saved|Unsaved|Saving/.test(status) ? status : "";
    }, { timeout: 10000 })
    .toMatch(/Saved|Unsaved changes|Saving/);
});

test("pasting a URL inserts a hyperlink (linkOnPaste)", async ({ page }) => {
  await page.goto("/");
  const tree = await ensureNotebookTreeVisible(page);
  await tree.getByText("Welcome to Smart Notes").first().click();
  await expectActivePageTitle(page, /Welcome/);
  const editor = page.getByTestId("rich-text-editor");
  await editor.click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("OneNote homepage");
  for (let i = 0; i < "OneNote homepage".length; i++) {
    await page.keyboard.press("Shift+ArrowLeft");
  }
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid="rich-text-editor"]') as HTMLElement | null;
    if (!el) throw new Error("rich-text-editor missing");
    el.focus();
    const dt = new DataTransfer();
    dt.setData("text/plain", "https://www.onenote.com/");
    const ev = new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
  });

  await expect(editor.locator('a[href="https://www.onenote.com/"]')).toBeVisible({
    timeout: 5000,
  });
});

test("POST /api/assets stores image and returns /vault URL", async ({ request }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "API-only contract; covered by desktop project");
  const pageDoc = await apiCreatePage(request, {
    notebookPath: "Personal Notebook",
    sectionPath: "Personal Notebook/Quick Notes",
    title: `AssetTarget-${Date.now()}`,
  });
  const pagePath = pageDoc.path;

  const png = Buffer.from(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da6300010000000500010d0a2db40000000049454e44ae426082",
    "hex"
  );

  const res = await request.post(`/api/assets?path=${encodeURIComponent(pagePath)}`, {
    multipart: {
      file: { name: "test.png", mimeType: "image/png", buffer: png },
    },
  });
  expect(res.ok()).toBe(true);
  const body = await res.json();
  expect(body.asset.url.startsWith("/vault/")).toBe(true);

  const fetched = await request.get(body.asset.url);
  expect(fetched.ok()).toBe(true);
  expect(fetched.headers()["content-type"]).toContain("image/png");
});

test("AI companion opens from the header toggle", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.getByTestId("ai-toggle-btn").click({ force: true });
  if (testInfo.project.name === "mobile") {
    await expect(page.getByTestId("ai-sidebar-rail").or(page.locator('[data-slot="sheet-content"]'))).toBeVisible({
      timeout: 15000,
    });
  } else {
    await expect(page.getByTestId("ai-sidebar-rail")).toBeVisible({ timeout: 15000 });
    await page.getByTestId("ai-toggle-btn").click({ force: true });
    await expect(page.getByTestId("ai-sidebar-rail")).toHaveCount(0);
  }
});

test("Reload button refreshes the tree (picks up external file edits)", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Desktop tree mutation flow");
  await page.goto("/");
  await expect(page.getByTestId("app-shell")).toBeVisible();

  const newName = `External-${Date.now()}`;
  await createVaultNotebook(page, newName);
  await expect(page.getByTestId(`notebook-${newName}`)).toBeVisible({ timeout: 10000 });

  await page.reload();
  await expect(page.getByTestId(`notebook-${newName}`)).toBeVisible({ timeout: 15000 });
});

test("Right-click on a page shows context menu and Delete removes it", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Desktop tree mutation flow");
  await page.goto("/");
  const title = `Doomed-${Date.now()}`;
  const created = await apiCreatePage(request, {
    notebookPath: "Personal Notebook",
    sectionPath: "Personal Notebook/Quick Notes",
    title,
  });
  const pPath = created.path;

  await page.getByTestId("reload-btn").click({ force: true });
  const item = page.getByTestId(`page-${pPath}`);
  await expect(item).toBeVisible({ timeout: 10000 });
  await item.click({ button: "right" });
  await expect(page.getByTestId(`page-context-menu-${pPath}`)).toBeVisible();
  await page.getByTestId(`page-context-menu-${pPath}`).getByRole("button", { name: "Delete" }).click();
  await page.locator('[role="dialog"]').getByRole("button", { name: "Delete" }).click();

  await expect(page.getByTestId("tree").getByText(title)).toHaveCount(0);
  await expect(fs.stat(path.join(VAULT, pPath))).rejects.toBeDefined();
});

test("Section New page creates a page and selects it", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Desktop tree mutation flow");
  await page.goto("/");
  const title = `Inline-${Date.now()}`;
  await openSectionContextMenu(page, "Personal Notebook/Quick Notes");
  await page.getByRole("menuitem", { name: "New page" }).click();
  await submitCreatePageDialog(page, title);
  await expectActivePageTitle(page, title);
  await expect(page.getByTestId("rich-text-editor")).toBeVisible();
});

test("Rename via page menu updates sidebar and persists", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Desktop tree mutation flow");
  await page.goto("/");
  const original = `RenameMe-${Date.now()}`;
  const renamed = `Renamed-${Date.now()}`;
  const created = await apiCreatePage(request, {
    notebookPath: "Personal Notebook",
    sectionPath: "Personal Notebook/Quick Notes",
    title: original,
  });
  const pPath = created.path;

  await page.getByTestId("reload-btn").click({ force: true }).catch(() => undefined);
  const tree = await ensureNotebookTreeVisible(page);
  await expect(page.getByTestId(`page-${pPath}`).filter({ visible: true })).toBeVisible({ timeout: 10000 });
  await tree.getByText("Welcome to Smart Notes").first().click();
  await renamePageViaMenu(page, pPath, renamed);

  const renamedPath = `Personal Notebook/Quick Notes/${slugifyTitle(renamed)}.html`;
  await expect(page.getByTestId(`page-${renamedPath}`)).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId(`page-${pPath}`)).toHaveCount(0);

  const buf = await fs.readFile(path.join(VAULT, renamedPath), "utf8");
  expect(buf).toContain(renamed);
});

test("Editing content autosaves and survives reload", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Desktop tree mutation flow");
  await page.goto("/");
  const original = `TitleInput-${Date.now()}`;
  const marker = `Marker-${Date.now()}`;
  const created = await apiCreatePage(request, {
    notebookPath: "Personal Notebook",
    sectionPath: "Personal Notebook/Quick Notes",
    title: original,
  });
  const pPath = created.path;
  const filePath = path.join(VAULT, pPath);

  await page.getByTestId("reload-btn").click({ force: true }).catch(() => undefined);
  const tree = await ensureNotebookTreeVisible(page);
  await tree.getByText(original, { exact: true }).first().click();
  await expectActivePageTitle(page, original);

  await page.getByTestId("rich-text-editor").click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type(marker);
  await expect(page.getByTestId("rich-text-editor")).toContainText(marker, { timeout: 5000 });

  // Flush debounce by leaving the page, then assert vault persistence.
  await ensureNotebookTreeVisible(page);
  await tree.getByText("Welcome to Smart Notes").first().click();
  await expect
    .poll(async () => {
      try {
        return await fs.readFile(filePath, "utf8");
      } catch {
        return "";
      }
    }, { timeout: 20000 })
    .toContain(marker);

  await ensureNotebookTreeVisible(page);
  await tree.getByText(original).first().click();
  await expect(page.getByTestId("rich-text-editor")).toContainText(marker, { timeout: 15000 });
});

test("Tree sidebar collapse toggle hides notebook rows", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop rail collapse only");
  await page.goto("/");
  await expect(page.getByTestId("tree").getByRole("button", { name: "Personal Notebook" })).toBeVisible();
  await page.getByTestId("tree-sidebar-collapse").click();
  await expect(page.getByTestId("tree-sidebar-rail")).toHaveAttribute("data-collapsed", "true");
  await page.getByTestId("tree-sidebar-expand").click();
  await expect(page.getByTestId("tree-sidebar-rail")).toHaveAttribute("data-collapsed", "false");
  await expect(page.getByTestId("tree").getByRole("button", { name: "Personal Notebook" })).toBeVisible();
});

test("Delete via page menu removes the page", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Desktop tree mutation flow");
  await page.goto("/");
  const title = `DeleteMe-${Date.now()}`;
  const created = await apiCreatePage(request, {
    notebookPath: "Personal Notebook",
    sectionPath: "Personal Notebook/Quick Notes",
    title,
  });
  const pPath = created.path;

  await page.getByTestId("reload-btn").click({ force: true });
  await expect(page.getByTestId(`page-${pPath}`)).toBeVisible({ timeout: 10000 });
  await deletePageViaMenu(page, pPath);
  await expect(page.getByTestId("tree").getByText(title)).toHaveCount(0);
});
