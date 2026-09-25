import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import {
  deletePageViaMenu,
  ensureNotebookTreeVisible,
  expectActivePageTitle,
  renamePageViaMenu,
  submitCreatePageDialog,
} from "./helpers";

const VAULT = path.resolve(__dirname, "..", ".e2e-vault");
const EVIDENCE_DIR = path.resolve(__dirname, "..", "evidence", "SN-3");

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

test("create, autosave, reload, reopen, rename, and delete persists against the vault", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Desktop tree/menu workflow; mobile covered by SN-4 navigation");
  const createdTitle = `SN3 Created ${Date.now()}`;
  const renamedTitle = `${createdTitle} Renamed`;
  const bodyText = `SN-3 reliability marker ${Date.now()}`;
  const createdPath = `Personal Notebook/Quick Notes/${slugifyTitle(createdTitle)}.html`;
  const renamedPath = `Personal Notebook/Quick Notes/${slugifyTitle(renamedTitle)}.html`;
  const createdFile = path.join(VAULT, "Personal Notebook", "Quick Notes", `${slugifyTitle(createdTitle)}.html`);
  const renamedFile = path.join(VAULT, "Personal Notebook", "Quick Notes", `${slugifyTitle(renamedTitle)}.html`);

  await fs.mkdir(EVIDENCE_DIR, { recursive: true });

  await page.goto("/");
  await expect(page.getByTestId("app-shell")).toBeVisible();

  await page.locator('[data-testid="section-menu-Personal Notebook/Quick Notes"]').click();
  await page.getByRole("menuitem", { name: "New page" }).click();
  await submitCreatePageDialog(page, createdTitle);

  const editor = page.getByTestId("rich-text-editor");
  await expectActivePageTitle(page, createdTitle);
  await expect(editor).toBeVisible({ timeout: 20000 });

  // New pages seed an H1 title — replace contents so body text is definitely saved.
  await editor.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.type(`${createdTitle}`);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type(bodyText);
  await expect(editor).toContainText(bodyText, { timeout: 5000 });

  // Navigate away to flush debounced save, then verify disk.
  await page.getByTestId("tree").getByText("Welcome to Smart Notes").first().click();
  await page.getByTestId("tree").getByText(createdTitle).first().click();
  await expectActivePageTitle(page, createdTitle);
  await expect(editor).toContainText(bodyText, { timeout: 15000 });

  await expect
    .poll(async () => {
      try {
        return await fs.readFile(createdFile, "utf8");
      } catch {
        return "";
      }
    }, { timeout: 20000 })
    .toContain(bodyText);
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "sn-3-after-autosave.png"), fullPage: true });

  const persistedSource = await fs.readFile(createdFile, "utf8");
  expect(persistedSource).toContain(createdTitle);
  expect(persistedSource).toContain(bodyText);

  await renamePageViaMenu(page, createdPath, renamedTitle);
  await expect(page.getByTestId(`page-${renamedPath}`)).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId(`page-${createdPath}`)).toHaveCount(0);
  await expect
    .poll(async () => {
      try {
        return await fs.readFile(renamedFile, "utf8");
      } catch {
        return "";
      }
    }, { timeout: 15000 })
    .toContain(renamedTitle);
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "sn-3-after-rename.png"), fullPage: true });

  await expect(fs.stat(createdFile)).rejects.toBeDefined();
  const renamedSource = await fs.readFile(renamedFile, "utf8");
  expect(renamedSource).toContain(renamedTitle);
  expect(renamedSource).toContain(bodyText);

  await deletePageViaMenu(page, renamedPath);
  await expect(page.getByTestId(`page-${renamedPath}`)).toHaveCount(0);
  await expect
    .poll(async () => {
      try {
        await fs.stat(renamedFile);
        return "present";
      } catch {
        return "missing";
      }
    }, { timeout: 15000 })
    .toBe("missing");
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "sn-3-after-delete.png"), fullPage: true });
});
