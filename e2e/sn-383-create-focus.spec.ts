import { expect, test } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

test.use({ serviceWorkers: "block" });

test("SN-383 sidebar and toolbar create select the new page and section names", async ({ page, request }, testInfo) => {
  test.setTimeout(120_000);
  test.skip(testInfo.project.name !== "desktop", "desktop sidebar and toolbar");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const rail = page.getByTestId("notebook-rail-sidebar");
  const pagePane = page.getByTestId("tree-sidebar-rail");
  await rail.getByRole("button", { name: "Quick Notes", exact: true }).click();
  const createdSections: string[] = [];
  const createdPages: string[] = [];
  const evidenceDir = path.resolve(__dirname, "../evidence/SN-383");
  await fs.mkdir(evidenceDir, { recursive: true });

  try {
    const sectionCreated = page.waitForResponse((r) => r.url().endsWith("/api/section") && r.request().method() === "POST" && r.ok());
    await rail.getByRole("button", { name: "New section", exact: true }).first().click();
    const sectionResponse = await sectionCreated;
    const { section } = await sectionResponse.json() as { section: { path: string } };
    createdSections.push(section.path);
    const sectionInput = rail.getByRole("textbox", { name: "Section name" });
    await expect(sectionInput).toBeFocused();
    const defaultSection = await sectionInput.inputValue();
    await expect.poll(() => sectionInput.evaluate((input: HTMLInputElement) => [input.selectionStart, input.selectionEnd]))
      .toEqual([0, defaultSection.length]);
    await page.screenshot({ path: path.join(evidenceDir, "desktop-section-selected.png") });
    const renamedSection = `SN383 Section ${Date.now()}`;
    const sectionRenamed = page.waitForResponse((r) => r.url().endsWith("/api/section") && r.request().method() === "PATCH" && r.ok());
    await page.keyboard.type(renamedSection);
    await page.keyboard.press("Enter");
    const renamedResponse = await sectionRenamed;
    const renamed = await renamedResponse.json() as { section: { path: string } };
    createdSections[0] = renamed.section.path;
    await expect(rail.getByRole("button", { name: renamedSection, exact: true })).toBeVisible();

    const pageCreated = page.waitForResponse((r) => r.url().endsWith("/api/page") && r.request().method() === "POST" && r.ok());
    await pagePane.getByTestId("page-pane-add-page").click();
    createdPages.push((await (await pageCreated).json() as { page: { path: string } }).page.path);
    const titleInput = page.getByRole("textbox", { name: "Page title" }).first();
    await expect(titleInput).toBeFocused();
    const defaultTitle = await titleInput.inputValue();
    await expect.poll(() => titleInput.evaluate((input: HTMLInputElement) => [input.selectionStart, input.selectionEnd]))
      .toEqual([0, defaultTitle.length]);
    await page.screenshot({ path: path.join(evidenceDir, "desktop-page-selected.png") });
    await page.keyboard.press("Escape");
    await expect(titleInput).toHaveValue(defaultTitle);

    await page.getByRole("button", { name: "More", exact: true }).click();
    const toolbarPageCreated = page.waitForResponse((r) => r.url().endsWith("/api/page") && r.request().method() === "POST" && r.ok());
    await page.getByRole("menuitem", { name: "New page", exact: true }).click();
    createdPages.push((await (await toolbarPageCreated).json() as { page: { path: string } }).page.path);
    await expect(titleInput).toBeFocused();
    const toolbarDefaultTitle = await titleInput.inputValue();
    await expect.poll(() => titleInput.evaluate((input: HTMLInputElement) => [input.selectionStart, input.selectionEnd]))
      .toEqual([0, toolbarDefaultTitle.length]);
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "More", exact: true }).click();
    const toolbarSectionCreated = page.waitForResponse((r) => r.url().endsWith("/api/section") && r.request().method() === "POST" && r.ok());
    await page.getByRole("menuitem", { name: "New section", exact: true }).click();
    const toolbarSectionResponse = await toolbarSectionCreated;
    createdSections.push((await toolbarSectionResponse.json() as { section: { path: string } }).section.path);
    await expect(sectionInput).toBeFocused();
    const toolbarDefaultSection = await sectionInput.inputValue();
    await expect.poll(() => sectionInput.evaluate((input: HTMLInputElement) => [input.selectionStart, input.selectionEnd]))
      .toEqual([0, toolbarDefaultSection.length]);
    await page.keyboard.press("Escape");
  } finally {
    for (const pagePath of createdPages) {
      await request.delete(`/api/page?path=${encodeURIComponent(pagePath)}`).catch(() => undefined);
    }
    for (const sectionPath of createdSections) {
      await request.delete(`/api/section?path=${encodeURIComponent(sectionPath)}`).catch(() => undefined);
    }
  }
});
