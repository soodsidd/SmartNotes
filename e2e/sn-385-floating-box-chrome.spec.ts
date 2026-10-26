import { expect, test, type APIRequestContext } from "@playwright/test";
import fs from "node:fs/promises";
import { PNG } from "pngjs";
import path from "node:path";
import type { Editor } from "@tiptap/core";

test.use({ serviceWorkers: "block" });

async function seedPage(request: APIRequestContext, title: string, content: string) {
  const created = await request.post("/api/page", {
    data: { notebookPath: "Personal Notebook", sectionPath: "Personal Notebook/Quick Notes", title },
  });
  expect(created.ok()).toBeTruthy();
  const { page: saved } = await created.json() as { page: { path: string } };
  const seeded = await request.put("/api/page", { data: { path: saved.path, title, content } });
  expect(seeded.ok()).toBeTruthy();
  return saved.path;
}

test("SN-385 floating box chrome appears only while editing its content", async ({ page, request }, testInfo) => {
  test.setTimeout(120_000);
  test.skip(testInfo.project.name !== "desktop", "desktop screenshot evidence");
  const title = `sn385-chrome-${Date.now()}`;
  const pagePath = await seedPage(request, title,
    '<p>Main column</p><div data-type="floating-text-box" data-x="40" data-y="140" data-width="360" data-height="80"><div data-floating-box-content><p>Floating note</p></div></div>');

  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.getByTestId("tree-sidebar-rail").getByText(title, { exact: true }).click();
    const box = page.getByTestId("floating-text-box");
    const controls = box.locator(".floating-text-box__controls");
    const width = box.getByTestId("floating-text-box-resize-width");
    await expect(box).toBeVisible();
    // SN-314: width is the only resize; there is no corner (height) handle.
    await expect(box.getByTestId("floating-text-box-resize")).toHaveCount(0);
    await expect(box).toHaveAttribute("data-editing", "false");
    await expect(controls).toBeHidden();
    await expect(width).toBeHidden();
    await expect(box).toHaveCSS("border-top-color", "rgba(0, 0, 0, 0)");
    await box.hover();
    await expect(controls).toBeHidden();
    await expect(box).toHaveCSS("border-top-color", "rgba(0, 0, 0, 0)");

    const evidenceDir = path.resolve(__dirname, "../evidence/SN-385");
    await fs.mkdir(evidenceDir, { recursive: true });
    await page.screenshot({ path: path.join(evidenceDir, "idle.png") });
    await box.getByText("Floating note").click();
    await expect(box).toHaveAttribute("data-editing", "true");
    await expect(box).not.toHaveCSS("border-top-color", "rgba(0, 0, 0, 0)");
    await expect(controls).toBeVisible();
    await expect(width).toBeVisible();
    await page.screenshot({ path: path.join(evidenceDir, "editing.png") });
    await page.getByText("Main column").click();
    await expect(box).toHaveAttribute("data-editing", "false");
    await expect(controls).toBeHidden();
    await expect(box).toHaveCSS("border-top-color", "rgba(0, 0, 0, 0)");
  } finally {
    await request.delete(`/api/page?path=${encodeURIComponent(pagePath)}`).catch(() => undefined);
  }
});

test("SN-314 floating box fits its content; width drag reflows text; a wider image grows the box", async ({ page, request }, testInfo) => {
  test.setTimeout(120_000);
  test.skip(testInfo.project.name !== "desktop", "desktop screenshot evidence");
  const title = `sn314-fit-${Date.now()}`;
  const text = "OneNote style floating text wraps to whatever width the owner drags the box to, and the box height follows.";
  const png = new PNG({ width: 480, height: 240 });
  png.data.fill(160);
  const pngBase64 = PNG.sync.write(png).toString("base64");
  // data-height="300" is a stale pre-SN-314 value; it must not leave empty chrome.
  const pagePath = await seedPage(request, title,
    `<p>Main column</p><div data-type="floating-text-box" data-x="40" data-y="140" data-width="360" data-height="300"><div data-floating-box-content><p>${text}</p></div></div>` +
    `<div data-type="floating-text-box" data-x="40" data-y="520" data-width="200"><div data-floating-box-content><p>Image box</p></div></div>`);

  const measure = (locator: ReturnType<typeof page.getByTestId>) => locator.evaluate((el) => {
    const content = el.querySelector<HTMLElement>(".floating-text-box__content")!;
    const style = getComputedStyle(el);
    const chrome = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) +
      parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
    return { height: el.offsetHeight, width: el.offsetWidth, fit: Math.ceil(content.scrollHeight + chrome), minHeight: style.minHeight };
  });

  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/");
    await page.getByTestId("tree-sidebar-rail").getByText(title, { exact: true }).click();
    const [textBox, imageBox] = [page.getByTestId("floating-text-box").first(), page.getByTestId("floating-text-box").nth(1)];
    await expect(textBox).toBeVisible();

    const initial = await measure(textBox);
    expect(initial.minHeight).toMatch(/^(0px|auto)$/);
    expect(Math.abs(initial.height - initial.fit)).toBeLessThanOrEqual(1);
    expect(initial.height).toBeLessThan(300);

    const evidenceDir = path.resolve(__dirname, "../evidence/SN-314");
    await fs.mkdir(evidenceDir, { recursive: true });
    await page.screenshot({ path: path.join(evidenceDir, "hidden-border.png") });
    await textBox.getByText(text).click();
    await expect(textBox).toHaveAttribute("data-editing", "true");
    await page.screenshot({ path: path.join(evidenceDir, "focused-border.png") });

    // Drag the width handle 160px left: text rewraps onto more lines and the box grows taller to fit.
    const handle = textBox.getByTestId("floating-text-box-resize-width");
    const grip = (await handle.boundingBox())!;
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(grip.x + grip.width / 2 - 160, grip.y + grip.height / 2, { steps: 8 });
    await page.mouse.up();
    await expect(textBox).toHaveAttribute("data-width", "200");
    const narrow = await measure(textBox);
    expect(narrow.width).toBe(200);
    expect(narrow.height).toBeGreaterThan(initial.height);
    expect(Math.abs(narrow.height - narrow.fit)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: path.join(evidenceDir, "width-reflow.png") });

    // Paste an image into the second box, then drag it wider than the box: the box
    // widens and grows taller to contain it, and its border stays up while the image is selected.
    await imageBox.getByText("Image box").click();
    await page.keyboard.press("End");
    const before = await measure(imageBox);
    const uploaded = page.waitForResponse((response) =>
      response.url().includes("/api/assets") && response.request().method() === "POST" && response.status() === 201);
    await page.locator(".ProseMirror.editor-content").evaluate((element, base64) => {
      const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], "sn314-fit.png", { type: "image/png" }));
      element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: transfer }));
    }, pngBase64);
    await uploaded;
    const picture = imageBox.locator("[data-resize-wrapper] > img");
    await expect.poll(async () => picture.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(480);
    // A pasted image is capped to the box; it must not ratchet the box wider.
    await page.waitForTimeout(500);
    await expect(imageBox).toHaveAttribute("data-width", "200");
    const pasted = await measure(imageBox);
    expect(pasted.height).toBeGreaterThan(before.height);
    expect(Math.abs(pasted.height - pasted.fit)).toBeLessThanOrEqual(1);
    await picture.click();
    await expect(imageBox).toHaveAttribute("data-editing", "true");
    await expect(imageBox).not.toHaveCSS("border-top-color", "rgba(0, 0, 0, 0)");
    const imageHandle = imageBox.locator('[data-resize-handle="right"]');
    const knob = (await imageHandle.boundingBox())!;
    await page.mouse.move(knob.x + knob.width / 2, knob.y + knob.height / 2);
    await page.mouse.down();
    await page.mouse.move(knob.x + knob.width / 2 + 240, knob.y + knob.height / 2, { steps: 10 });
    await page.mouse.up();
    await expect.poll(async () => (await measure(imageBox)).width).toBeGreaterThan(pasted.width + 150);
    const grown = await measure(imageBox);
    const imageRight = await picture.evaluate((img) => img.getBoundingClientRect().right);
    const boxRight = await imageBox.evaluate((el) => el.getBoundingClientRect().right);
    expect(imageRight).toBeLessThanOrEqual(boxRight);
    expect(grown.height).toBeGreaterThan(pasted.height);
    expect(Math.abs(grown.height - grown.fit)).toBeLessThanOrEqual(1);
    // No empty line under the image: ProseMirror's trailing break stays on the image's line.
    const trailing = await imageBox.evaluate((el) => {
      const image = el.querySelector("[data-resize-wrapper] > img")!.getBoundingClientRect();
      const tail = el.querySelector(".floating-text-box__content br.ProseMirror-trailingBreak")?.getBoundingClientRect();
      return { imageBottom: image.bottom, tailTop: tail?.top ?? -Infinity };
    });
    expect(trailing.tailTop).toBeLessThan(trailing.imageBottom);
    // A resized pixel image must take part in line layout, so later text stays
    // inside the content-fit border instead of appearing below it (SN-314 rework).
    await page.locator(".ProseMirror.editor-content").evaluate((element) => {
      const editor = (element as HTMLElement & { editor: Editor }).editor;
      let imagePos = -1;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "image") imagePos = pos;
      });
      if (imagePos < 0) throw new Error("Image missing from the editor document");
      editor.view.dispatch(editor.state.tr.insertText(" after image", imagePos + 1));
    });
    await expect(imageBox.getByText("after image")).toBeVisible();
    const contentBottom = await imageBox.getByText("after image").evaluate((el) => el.getBoundingClientRect().bottom);
    const boxBottom = await imageBox.evaluate((el) => el.getBoundingClientRect().bottom);
    expect(contentBottom).toBeLessThanOrEqual(boxBottom);
    await page.screenshot({ path: path.join(evidenceDir, "image-growth.png") });
  } finally {
    await request.delete(`/api/page?path=${encodeURIComponent(pagePath)}`).catch(() => undefined);
  }
});
