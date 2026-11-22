import { expect, test } from "@playwright/test";
import { clickShellMoreItem, dismissBlockingOverlays } from "./helpers";

test("SN-423 Settings mounts the Smart Notes ink note and annotation surfaces", async ({ page, request }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const sectionPath = "Personal Notebook/Quick Notes";
  const scene = {
    version: 2,
    strokes: [{ id: "smoke-ink", points: [[180, 130, 0.35], [230, 150, 0.8]], color: "blue", size: "xl", createdAt: 1 }],
  };
  const surfaces = [
    { title: "SN-423 Ink Smoke", noteType: "ink", api: "/api/ink" },
    { title: "SN-423 Annotation Smoke", noteType: "text", api: "/api/annotations" },
  ];

  for (const { title, noteType, api } of surfaces) {
    const created = await request.post("/api/page", { data: { sectionPath, title, noteType } });
    expect(created.status()).toBe(201);
    const { page: note } = await created.json();
    const saved = await request.put(api, { data: { path: note.path, engine: "smart-notes", scene } });
    expect(saved.ok()).toBe(true);
  }

  await page.goto("/");
  await dismissBlockingOverlays(page);
  await clickShellMoreItem(page, "app-settings-trigger");
  const settings = page.getByTestId("app-settings-dialog");
  const option = settings.getByRole("button", { name: "Smart Notes ink", exact: true });
  await option.click();
  await expect(option).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(settings).toBeHidden();

  for (const { title } of surfaces) {
    await page.getByTestId("tree").getByText(title, { exact: true }).first().click();
    const canvas = page.getByTestId("smart-notes-ink-surface");
    await expect(canvas).toBeVisible({ timeout: 20_000 });
    const stroke = canvas.locator('[data-sn-ink-stroke="smoke-ink"]');
    await expect(stroke).toBeVisible();
    await expect(stroke).toHaveAttribute("d", /^M.+Z$/);
  }
  expect(pageErrors).toEqual([]);
});
