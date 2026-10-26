import { test, expect, type Locator } from "@playwright/test";
import { PNG } from "pngjs";
import { apiCreatePage } from "./helpers";

const image = new PNG({ width: 480, height: 240 });
for (let y = 0; y < image.height; y += 1) {
  for (let x = 0; x < image.width; x += 1) {
    const pixel = (image.width * y + x) * 4;
    image.data[pixel] = 40;
    image.data[pixel + 1] = 130;
    image.data[pixel + 2] = 160;
    image.data[pixel + 3] = 255;
  }
}
const pngBase64 = PNG.sync.write(image).toString("base64");

async function geometry(container: Locator) {
  return container.evaluate((element) => {
    const picture = element.querySelector("[data-resize-wrapper] > img") as HTMLImageElement;
    const wrapper = element.querySelector("[data-resize-wrapper]") as HTMLElement;
    const handle = element.querySelector('[data-resize-handle="right"]') as HTMLElement;
    const imageRect = picture.getBoundingClientRect();
    const wrapperRect = wrapper.getBoundingClientRect();
    const handleRect = handle.getBoundingClientRect();
    return {
      naturalWidth: picture.naturalWidth,
      imageWidth: imageRect.width,
      imageRight: imageRect.right,
      wrapperWidth: wrapperRect.width,
      wrapperRight: wrapperRect.right,
      handleX: handleRect.x + handleRect.width / 2,
    };
  });
}

function expectAligned(bounds: Awaited<ReturnType<typeof geometry>>) {
  expect(bounds.naturalWidth).toBe(480);
  expect(bounds.imageWidth).toBeGreaterThan(200);
  expect(Math.abs(bounds.wrapperWidth - bounds.imageWidth)).toBeLessThan(3);
  expect(Math.abs(bounds.wrapperRight - bounds.imageRight)).toBeLessThan(3);
  expect(Math.abs(bounds.handleX - bounds.imageRight)).toBeLessThan(8);
}

test("SN-384: pasted image and handles share natural, reload, and preset geometry", async ({ page, request }, testInfo) => {
  test.setTimeout(120_000);
  const title = `sn384-${testInfo.project.name}-${Date.now()}`;
  const created = await apiCreatePage(request, {
    notebookPath: "Personal Notebook",
    sectionPath: "Personal Notebook/Quick Notes",
    title,
  });

  // Deep-link the page: opening the section first can leave its first page as
  // the stored active page, which a later vault refresh re-selects.
  const openCreatedPage = async () => {
    await page.goto(`/?page=${encodeURIComponent(created.path)}`);
    await expect(page.getByTestId("app-shell")).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Page title" }).first()).toHaveValue(title, { timeout: 20_000 });
  };
  await openCreatedPage();
  const editor = page.locator(".ProseMirror.editor-content");
  await expect(editor).toBeVisible();
  await editor.click();

  const uploaded = page.waitForResponse((response) =>
    response.url().includes("/api/assets") && response.request().method() === "POST" && response.status() === 201
  );
  await editor.evaluate((element, base64) => {
    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], "paste-geometry.png", { type: "image/png" }));
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: transfer }));
  }, pngBase64);
  await uploaded;

  const container = editor.locator('[data-resize-container][data-node="image"]');
  const picture = container.locator("[data-resize-wrapper] > img");
  await expect(picture).toBeVisible();
  await expect.poll(async () => picture.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(480);
  await picture.click();
  const pasted = await geometry(container);
  expectAligned(pasted);
  expect(pasted.imageWidth).toBeGreaterThanOrEqual(Math.min(480, (await editor.boundingBox())!.width) - 8);
  await page.screenshot({ path: `evidence/SN-384/${testInfo.project.name}-after.png` });

  const handle = container.locator('[data-resize-handle="right"]');
  await handle.dispatchEvent("mousedown");
  await page.evaluate(() => document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true })));
  // The committed pixel width rebuilds the NodeView; wait for the new bitmap.
  await expect.poll(async () => picture.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(480);
  const afterClick = await geometry(container);
  expectAligned(afterClick);
  expect(Math.abs(afterClick.imageWidth - pasted.imageWidth)).toBeLessThan(3);

  const savedBody = async () => {
    const response = await request.get(`/api/page?path=${encodeURIComponent(created.path)}`);
    return String(((await response.json()) as { page: { body: string } }).page.body);
  };
  await expect.poll(savedBody).toContain("<img");
  await openCreatedPage();
  await expect(picture).toBeVisible();
  await picture.click();
  const reloaded = await geometry(container);
  expectAligned(reloaded);
  expect(Math.abs(reloaded.imageWidth - pasted.imageWidth)).toBeLessThan(3);
  await page.screenshot({ path: `evidence/SN-384/${testInfo.project.name}-reload.png` });

  await page.getByTestId("image-width-50").click();
  await expect.poll(async () => container.evaluate((element: HTMLElement) => element.style.width)).toBe("50%");
  const preset = await geometry(container);
  expectAligned(preset);
  await expect.poll(savedBody).toContain('width="50%"');
  await openCreatedPage();
  await expect(picture).toBeVisible();
  await picture.click();
  const presetReloaded = await geometry(container);
  expectAligned(presetReloaded);
  expect(Math.abs(presetReloaded.imageWidth - preset.imageWidth)).toBeLessThan(3);
});
