import { expect, test } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

const EVIDENCE_DIR = path.resolve(__dirname, "..", "evidence", "sn-321");

test("SN-321: main column outline and resize grip follow editor focus", async ({ page }, testInfo) => {
  await page.goto("/");

  const editor = page.getByTestId("rich-text-editor");
  const frame = page.getByTestId("editor-content-frame");
  const outline = page.getByTestId("editor-main-flow-outline");
  const handle = page.getByTestId("editor-main-flow-resize");
  await expect(editor).toBeVisible();
  await expect(outline).toHaveCSS("visibility", "hidden");
  await expect(handle).toHaveCSS("visibility", "hidden");

  await fs.mkdir(EVIDENCE_DIR, { recursive: true });
  await page.screenshot({ path: path.join(EVIDENCE_DIR, `unfocused-${testInfo.project.name}.png`) });

  await editor.locator("p").first().click();
  await expect(frame).toHaveAttribute("data-main-flow-focused", "true");
  await expect(outline).toHaveCSS("visibility", "visible");
  if (testInfo.project.name === "desktop") {
    await expect(handle).toHaveCSS("visibility", "visible");
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "focused-desktop.png") });
    await page.keyboard.press("Shift+Tab");
    await expect(handle).toBeFocused();
    await expect(outline).toHaveCSS("visibility", "visible");
    await expect(handle).toHaveCSS("visibility", "visible");
  } else {
    await expect(handle).toBeHidden();
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "focused-mobile.png") });
  }

  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await expect(outline).toHaveCSS("visibility", "hidden");
  await expect(handle).toHaveCSS("visibility", "hidden");
});
