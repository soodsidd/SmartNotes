import fs from "node:fs/promises";
import path from "node:path";

import { expect, test } from "@playwright/test";

const ROOT = path.resolve(__dirname, "..");
const E2E_VAULT = path.join(ROOT, ".e2e-vault");
const PAGE_PATH = "Personal Notebook/Quick Notes/Filtering Lab.html";
const WORKING_DIR = path.join(E2E_VAULT, "Personal Notebook", "Quick Notes", "Filtering Lab.jupyter");

test.setTimeout(150_000);

test("SN-239 pinned profile provides Python signature help without modifying Filtering Lab", async ({ page, request }) => {
  const profileResponse = await request.get("/api/jupyter/profile");
  expect(profileResponse.ok()).toBe(true);
  const profile = await profileResponse.json() as {
    profileInstalled: boolean;
    lspInstalled: boolean;
    pylspReachable: boolean;
  };
  test.skip(
    !profile.profileInstalled || !profile.lspInstalled || !profile.pylspReachable,
    "Pinned Smart Notes Jupyter profile is not installed in this CI environment; graceful PATH-only launch is covered by unit tests."
  );

  await fs.mkdir(WORKING_DIR, { recursive: true });
  await Promise.all([
    fs.writeFile(
      path.join(E2E_VAULT, PAGE_PATH),
      "---\ntitle: Filtering Lab\nnote_type: jupyter\n---\n",
      "utf8"
    ),
    fs.copyFile(
      path.join(ROOT, "tests", "fixtures", "filtering-lab", "notebook.ipynb"),
      path.join(WORKING_DIR, "notebook.ipynb")
    ),
  ]);
  const before = await fs.readFile(path.join(WORKING_DIR, "notebook.ipynb"));

  await page.goto("/");
  await page.getByText("Filtering Lab", { exact: true }).first().click();
  const frame = page.frameLocator('iframe[title="Jupyter notebook: Filtering Lab"]');
  const editor = frame.locator(".jp-Notebook-cell .cm-content").first();
  await expect(editor).toBeVisible({ timeout: 60_000 });
  await expect(frame.getByText("Fully initialized", { exact: true })).toBeVisible({ timeout: 60_000 });
  await editor.click();
  await editor.press("Control+End");
  await editor.press("Enter");
  await editor.pressSequentially("os.path.join", { delay: 75 });
  // Let the notebook adapter publish the preceding edit before sending the
  // signature trigger character. CI rendering can otherwise outrun the
  // virtual-document update even after the server reports initialized.
  await page.waitForTimeout(1_000);
  await editor.press("(");

  await expect(
    frame.locator(".lsp-signature-help").first()
  ).toBeVisible({ timeout: 20_000 });
  expect(await fs.readFile(path.join(WORKING_DIR, "notebook.ipynb"))).toEqual(before);

  await page.getByTestId("app-settings-trigger").click();
  const dialog = page.getByTestId("app-settings-dialog");
  const profileStatus = page.getByTestId("settings-jupyter-profile-status");
  await expect(profileStatus).toContainText(
    "JupyterLab 4.4.7 (Smart Notes profile) · LSP installed · pylsp reachable",
    { timeout: 30_000 }
  );
  await profileStatus.scrollIntoViewIfNeeded();
  await dialog.screenshot({ path: path.join(ROOT, "e2e", "evidence", "sn-239-jupyter-profile-status.png") });
});
