import { test, expect, type Page } from "@playwright/test";
import { apiCreatePage } from "./helpers";

// 1x1 transparent PNG, reused for every fixture upload below.
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function pngFile(name: string) {
  return { name, mimeType: "image/png", buffer: Buffer.from(PNG_BASE64, "base64") };
}

async function insertImageViaToolbar(page: Page, fileName: string) {
  // Insert image input has no capture attribute (unlike the camera input) and
  // accepts exactly "image/*" (unlike the mixed PDF/image attachment input).
  // Target it directly with setInputFiles rather than clicking the "Insert
  // image" menu item first: that item calls `fileInputRef.current.click()`,
  // which opens a real native file-chooser dialog under Playwright and hangs
  // the run. setInputFiles drives the same change-event handler without it.
  const input = page.locator('input[type="file"][accept="image/*"]:not([capture])');
  // Upload round-trips through /api/assets (201 Created) before the editor
  // command runs. Arm the wait before setInputFiles — the fetch can resolve
  // before the next line if we wait after the fact (classic Playwright race).
  const uploadResponse = page.waitForResponse(
    (r) => r.url().includes("/api/assets") && r.request().method() === "POST" && r.status() === 201,
    { timeout: 20000 }
  );
  await input.setInputFiles(pngFile(fileName));
  await uploadResponse;
}

test("SN-343: cursor lands beside an inserted image so a second image/text follows inline", async ({
  page,
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop editor toolbar only");
  const stamp = String(Date.now());
  const title = `sn343-${stamp}`;

  await apiCreatePage(request, {
    notebookPath: "Personal Notebook",
    sectionPath: "Personal Notebook/Quick Notes",
    title,
  });

  await page.goto("/");
  await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: 15000 });
  const asideVisible = await page.locator("aside").first().isVisible();
  if (!asideVisible) {
    await page.getByTestId("open-sidebar-btn").click();
  }
  await page.getByTestId("tree").getByText(title, { exact: true }).first().click();
  await expect(page.getByTestId("annotated-editor-panel")).toBeVisible({ timeout: 15000 });

  const editor = page.locator(".ProseMirror.editor-content");
  await expect(editor).toBeVisible({ timeout: 10000 });
  // Images render through Tiptap's resize NodeView: the <img> sits inside a
  // wrapper (no `editor-image` class), and ProseMirror puts
  // `ProseMirror-selectednode` on that wrapper when the node is selected.
  const images = editor.locator('img[src^="/vault/"]');
  const selectedNode = editor.locator(".ProseMirror-selectednode");

  // Insert the first image.
  await insertImageViaToolbar(page, "sn343-a.png");
  await expect(images).toHaveCount(1, { timeout: 10000 });
  // AC: the cursor is a text caret beside the image, not a NodeSelection on it.
  await expect(selectedNode).toHaveCount(0);

  // AC: repeating insert-image from that cursor adds the next image beside
  // the first (same paragraph row) instead of replacing it.
  await insertImageViaToolbar(page, "sn343-b.png");
  await expect(images).toHaveCount(2, { timeout: 10000 });
  await expect(selectedNode).toHaveCount(0);
  const sameParagraph = await editor.evaluate((root) => {
    const imgs = Array.from(root.querySelectorAll('img[src^="/vault/"]'));
    if (imgs.length < 2) return false;
    return imgs[0].closest("p") === imgs[1].closest("p") && imgs[0].closest("p") != null;
  });
  expect(sameParagraph).toBe(true);

  // AC: typing from the landed cursor continues the flow (text, not a
  // replaced/deleted image).
  await page.keyboard.type("more notes after the images");
  await expect(editor).toContainText("more notes after the images");
  await expect(images).toHaveCount(2);
});
