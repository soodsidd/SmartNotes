import fs from "node:fs";
import path from "node:path";
import { test, expect, type APIRequestContext, type CDPSession, type Page } from "@playwright/test";
import { PNG } from "pngjs";
import { apiCreatePage } from "./helpers";

// SN-391: mobile tap/type/resize matrix around inline images. Every probe is a
// soft check so one run inventories all failures instead of stopping at the first.

function pngBuffer(width: number, height: number, rgb: [number, number, number]) {
  const image = new PNG({ width, height });
  for (let index = 0; index < width * height; index += 1) {
    image.data[index * 4] = rgb[0];
    image.data[index * 4 + 1] = rgb[1];
    image.data[index * 4 + 2] = rgb[2];
    image.data[index * 4 + 3] = 255;
  }
  return PNG.sync.write(image);
}

async function uploadAsset(request: APIRequestContext, pagePath: string, name: string, buffer: Buffer) {
  const response = await request.post(`/api/assets?path=${encodeURIComponent(pagePath)}`, {
    multipart: { file: { name, mimeType: "image/png", buffer } },
  });
  expect(response.status()).toBe(201);
  return String(((await response.json()) as { asset: { url: string } }).asset.url);
}

type EditorState = {
  selection: "node" | "text" | "other";
  nodeName: string | null;
  parentText: string;
  selectedNodes: number;
  visibleHandles: number;
  resizing: number;
  floatingBoxes: number;
  focused: boolean;
};

async function editorState(page: Page): Promise<EditorState> {
  return page.evaluate(() => {
    const dom = document.querySelector(".ProseMirror.editor-content") as HTMLElement & {
      editor: { state: { selection: { node?: { type: { name: string } }; $from: { parent: { textContent: string } }; empty: boolean } } };
    };
    const { selection } = dom.editor.state;
    const isNode = Boolean(selection.node);
    const handles = Array.from(dom.querySelectorAll<HTMLElement>('[data-node="image"] [data-resize-handle]'));
    return {
      selection: isNode ? "node" : selection.empty !== undefined ? "text" : "other",
      nodeName: selection.node?.type.name ?? null,
      parentText: selection.$from.parent.textContent,
      selectedNodes: dom.querySelectorAll(".ProseMirror-selectednode").length,
      visibleHandles: handles.filter((handle) => {
        const style = getComputedStyle(handle);
        const rect = handle.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      }).length,
      resizing: dom.querySelectorAll('[data-resize-state="true"]').length,
      floatingBoxes: dom.querySelectorAll('[data-type="floating-text-box"]').length,
      focused: dom === document.activeElement || dom.contains(document.activeElement),
    };
  });
}

/** ProseMirror applies touch selections on `selectionchange`; give it a moment. */
async function settledState(page: Page, accept: (state: EditorState) => boolean) {
  let state = await editorState(page);
  for (let attempt = 0; attempt < 15 && !accept(state); attempt += 1) {
    await page.waitForTimeout(100);
    state = await editorState(page);
  }
  return state;
}

async function imageBox(page: Page, index: number) {
  const box = await page.locator('.ProseMirror [data-node="image"] [data-resize-wrapper] > img').nth(index).boundingBox();
  expect(box).not.toBeNull();
  return box!;
}

async function textBox(page: Page, text: string) {
  const box = await page.locator(".ProseMirror p").filter({ hasText: text }).first().boundingBox();
  expect(box).not.toBeNull();
  return box!;
}

async function touchDrag(cdp: CDPSession, from: { x: number; y: number }, to: { x: number; y: number }) {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [from] });
  for (let step = 1; step <= 6; step += 1) {
    const x = from.x + ((to.x - from.x) * step) / 6;
    const y = from.y + ((to.y - from.y) * step) / 6;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y }] });
  }
  // Hold before lifting so the swipe has no fling: a tap during a fling only
  // stops the scroll and never becomes a click, on phones as well as here.
  await new Promise((resolve) => setTimeout(resolve, 250));
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [to] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

async function imageWidth(page: Page, index: number) {
  return (await imageBox(page, index)).width;
}

test("SN-391: mobile taps around images place a caret; handles only on intent", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "Touch matrix runs on the mobile project");
  test.setTimeout(180_000);
  const findings: Array<{ probe: string; ok: boolean; detail: string }> = [];
  const check = (probe: string, ok: boolean, detail: unknown) => {
    findings.push({ probe, ok, detail: typeof detail === "string" ? detail : JSON.stringify(detail) });
    expect.soft(ok, `${probe}: ${JSON.stringify(detail)}`).toBe(true);
  };
  const expectState = async (probe: string, accept: (state: EditorState) => boolean) => {
    const settled = await settledState(page, accept);
    check(probe, accept(settled), settled);
    return settled;
  };

  const title = `sn391-${Date.now()}`;
  const created = await apiCreatePage(request, {
    notebookPath: "Personal Notebook",
    sectionPath: "Personal Notebook/Quick Notes",
    title,
  });
  const wide = await uploadAsset(request, created.path, "sn391-wide.png", pngBuffer(480, 240, [40, 130, 160]));
  const left = await uploadAsset(request, created.path, "sn391-left.png", pngBuffer(240, 160, [160, 90, 40]));
  const right = await uploadAsset(request, created.path, "sn391-right.png", pngBuffer(240, 160, [90, 150, 60]));
  const body = [
    "Intro paragraph above the pictures.",
    "",
    `<img src="${wide}">`,
    "",
    "Middle paragraph between images.",
    "",
    `<img src="${left}" width="35%"><img src="${right}" width="35%">`,
    "",
  ].join("\n");
  const saved = await request.put("/api/page", { data: { path: created.path, title, content: body } });
  expect(saved.ok()).toBe(true);

  await page.goto(`/?page=${encodeURIComponent(created.path)}`);
  await expect(page.getByTestId("app-shell")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Page title" }).first()).toHaveValue(title, { timeout: 20_000 });
  const editor = page.locator(".ProseMirror.editor-content");
  const pictures = editor.locator('[data-node="image"] [data-resize-wrapper] > img');
  await expect(pictures).toHaveCount(3);
  for (let index = 0; index < 3; index += 1) {
    await expect.poll(() => pictures.nth(index).evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  }
  // Opening normalizes the seeded markdown and saves once; probe after it lands.
  await expect.poll(() => page.getByTestId("save-status").first().textContent(), { timeout: 20_000 }).not.toMatch(/Saving|Unsaved/i);
  const cdp = await page.context().newCDPSession(page);
  const shots = path.join("evidence", "SN-391");
  fs.mkdirSync(shots, { recursive: true });

  // P0: resize handles are selection chrome; an unselected image shows none.
  await page.touchscreen.tap(...center(await textBox(page, "Intro paragraph")));
  let state = await expectState("P0 unselected images hide resize handles", (s) => s.visibleHandles === 0);

  // P1: intentionally tapping the image selects it and shows its handles.
  await page.touchscreen.tap(...center(await imageBox(page, 0)));
  state = await expectState("P1 tap image selects it with handles", (s) => s.nodeName === "image" && s.visibleHandles === 2);
  await page.screenshot({ path: path.join(shots, "mobile-selected.png") });

  // P2: tap another paragraph while the image is selected -> caret there.
  const middle = await textBox(page, "Middle paragraph");
  await page.touchscreen.tap(middle.x + middle.width - 4, middle.y + middle.height / 2);
  state = await expectState("P2 tap paragraph dismisses image and places caret", (s) => s.selection === "text" && s.parentText.startsWith("Middle") && s.visibleHandles === 0 && s.focused);
  await page.keyboard.type(" typed-after-dismiss");
  await expect.soft(editor).toContainText("between images. typed-after-dismiss");
  check("P2b typing after dismiss keeps all images", (await pictures.count()) === 3, await pictures.count());
  await page.screenshot({ path: path.join(shots, "mobile-caret-after-dismiss.png") });

  // P3: the old handle hit-zone just right of an unselected image must place a
  // caret (or select the image), never start a resize that never ends.
  const smallBefore = await imageBox(page, 1);
  await page.touchscreen.tap(smallBefore.x + smallBefore.width + 2, smallBefore.y + smallBefore.height / 2);
  state = await expectState("P3 tap beside image edge does not start a resize", (s) => s.resizing === 0);
  // P4: a later swipe anywhere must not resize an image (stuck touch resize).
  await touchDrag(cdp, { x: 200, y: 140 }, { x: 120, y: 140 });
  check(
    "P4 later swipe leaves image width unchanged",
    Math.abs((await imageWidth(page, 1)) - smallBefore.width) < 2,
    { before: smallBefore.width, after: await imageWidth(page, 1) }
  );
  // The editor canvas is wider than a phone (SN-321 outline), so that swipe
  // panned it sideways; undo the pan so later coordinates stay on screen.
  await page.locator(".editor-scroll-area").evaluate((area: HTMLElement) => { area.scrollLeft = 0; });

  // P6: tap just below the last image (still within the editor column).
  await page.touchscreen.tap(...center(await imageBox(page, 2)));
  // P15: the right-hand image's toolbar stays on screen (no sideways page pan).
  await expectState("P6a tap the right-hand image selects it", (s) => s.nodeName === "image" && s.visibleHandles === 2);
  await expect(page.getByTestId("image-bubble-menu")).toBeVisible();
  const overflow = await page.evaluate(() => {
    const menu = document.querySelector('[data-testid="image-bubble-menu"]')!.getBoundingClientRect();
    return { menuLeft: menu.left, menuRight: menu.right, viewport: window.innerWidth, scrollWidth: document.documentElement.scrollWidth };
  });
  check(
    "P15 toolbar for a right-hand image stays inside the viewport",
    overflow.menuLeft >= 0 && overflow.menuRight <= overflow.viewport && overflow.scrollWidth <= overflow.viewport,
    overflow
  );
  // P16: with one image selected, tapping its neighbour selects the neighbour
  // (the toolbar must not cover it).
  await page.touchscreen.tap(...center(await imageBox(page, 1)));
  await expectState("P16 tap neighbouring image selects it", (s) => s.nodeName === "image" && s.visibleHandles === 2);
  const selectedIndex = await editor.evaluate((root) =>
    Array.from(root.querySelectorAll('[data-node="image"]')).findIndex((node) => node.classList.contains("ProseMirror-selectednode"))
  );
  check("P16b the tapped neighbour is the selected one", selectedIndex === 1, selectedIndex);
  await page.touchscreen.tap(...center(await imageBox(page, 2)));
  const lastImage = await imageBox(page, 2);
  const boxesBefore = (await editorState(page)).floatingBoxes;
  await page.touchscreen.tap(lastImage.x + lastImage.width / 2, lastImage.y + lastImage.height + 24);
  state = await expectState("P6 tap below last image places a flow caret", (s) => s.selection === "text" && s.visibleHandles === 0 && s.floatingBoxes === boxesBefore && s.focused);
  await page.keyboard.type("below");
  const tail = await editor.evaluate((root) => root.querySelectorAll('[data-node="image"]')[2]?.closest("p")?.textContent ?? "");
  check("P6b typing after tap-below lands after the last image", tail.endsWith("below"), tail);


  // P5: tap beside the two-image row (empty line space after the last image)
  // puts the caret at the end of that paragraph instead of selecting an image.
  await page.touchscreen.tap(...center(await imageBox(page, 0)));
  const rightImage = await imageBox(page, 2);
  const row = (await editor.locator("p").filter({ has: page.locator('[data-node="image"]') }).last().boundingBox())!;
  await page.touchscreen.tap(row.x + row.width - 4, rightImage.y + rightImage.height / 2);
  state = await expectState("P5 tap beside last image places caret in its line", (s) => s.selection === "text" && s.visibleHandles === 0);
  await page.keyboard.type("after-row");
  const rowText = await editor.evaluate((root) => {
    const img = root.querySelectorAll('[data-node="image"]')[2];
    return img?.closest("p")?.textContent ?? "";
  });
  check("P5b typing lands after the image row", rowText.includes("after-row") && (await pictures.count()) === 3, rowText);

  // P7: tap between two adjacent images, type -> text between them.
  const leftImage = await imageBox(page, 1);
  const between = await imageBox(page, 2);
  await page.touchscreen.tap((leftImage.x + leftImage.width + between.x) / 2, leftImage.y + leftImage.height - 6);
  state = await expectState("P7 tap the gap between images places a caret", (s) => s.selection === "text" && s.visibleHandles === 0);
  await page.keyboard.type("MID");
  const order = await editor.evaluate((root) => {
    const paragraph = root.querySelectorAll('[data-node="image"]')[1]?.closest("p");
    if (!paragraph) return "";
    return Array.from(paragraph.childNodes)
      .map((node) => ((node as Element).matches?.('[data-node="image"]') ? "IMG" : node.textContent?.trim() ?? ""))
      .filter(Boolean)
      .join("|");
  });
  check("P7b text inserted between the two images", /IMG\|MID\|IMG/.test(order), order);

  // P8: tap the intro paragraph (above image) after selecting the image.
  await page.touchscreen.tap(...center(await imageBox(page, 0)));
  const intro = await textBox(page, "Intro paragraph");
  await page.touchscreen.tap(intro.x + 20, intro.y + intro.height / 2);
  state = await expectState("P8 tap above image places caret there", (s) => s.selection === "text" && s.parentText.startsWith("Intro"));

  // P9: empty paragraph — create one under the middle text and tap into it.
  // Tap the blank space after the paragraph's last line (no End key on a phone).
  const lineEnd = await editor.locator("p").filter({ hasText: "Middle paragraph" }).evaluate((paragraph) => {
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    const last = Array.from(range.getClientRects()).at(-1)!;
    return { x: Math.min(paragraph.getBoundingClientRect().right - 4, last.right + 12), y: last.top + last.height / 2 };
  });
  await page.touchscreen.tap(lineEnd.x, lineEnd.y);
  await expectState("P9a tap after a line places caret at its end", (s) => s.selection === "text" && s.parentText.endsWith("typed-after-dismiss"));
  await page.keyboard.press("Enter");
  await page.keyboard.type("x");
  await page.keyboard.press("Backspace");
  await page.touchscreen.tap(...center(await imageBox(page, 0)));
  const empty = await editor.evaluate((root) => {
    const paragraph = Array.from(root.querySelectorAll("p")).find((p) => p.textContent === "" && !p.querySelector("img"));
    const rect = paragraph?.getBoundingClientRect();
    return rect ? { x: rect.x + 30, y: rect.y + rect.height / 2 } : null;
  });
  check("P9 empty paragraph exists", empty !== null, empty);
  if (empty) {
    await page.touchscreen.tap(empty.x, empty.y);
    state = await expectState("P9b tap empty paragraph places caret", (s) => s.selection === "text" && s.parentText === "" && s.visibleHandles === 0);
  }

  // P10: double-tap a word after dismissing the image -> text, not image.
  await page.touchscreen.tap(...center(await imageBox(page, 0)));
  const middleWord = await textBox(page, "Middle paragraph");
  await page.touchscreen.tap(middleWord.x + 12, middleWord.y + middleWord.height / 2);
  await page.touchscreen.tap(middleWord.x + 12, middleWord.y + middleWord.height / 2);
  state = await expectState("P10 double-tap text stays a text selection", (s) => s.selection === "text" && s.visibleHandles === 0);

  // P11: scroll, then tap text -> caret, and no image resized by the scroll.
  const widthsBefore = await Promise.all([0, 1, 2].map((index) => imageWidth(page, index)));
  await touchDrag(cdp, { x: 215, y: 700 }, { x: 215, y: 500 });
  // Tap whichever text line is visible after the scroll (stale coordinates
  // could land on the app header instead of the note).
  const visibleLine = await page.locator(".editor-scroll-area").evaluate((area) => {
    const bounds = area.getBoundingClientRect();
    const paragraph = Array.from(area.querySelectorAll<HTMLElement>(".ProseMirror > p")).find((candidate) => {
      const rect = candidate.getBoundingClientRect();
      return candidate.innerText.trim() !== "" && rect.top >= bounds.top + 8 && rect.bottom <= bounds.bottom - 8;
    });
    if (!paragraph) return null;
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    const first = range.getClientRects()[0];
    return { x: first.left + Math.min(20, first.width / 2), y: first.top + first.height / 2, text: paragraph.innerText.trim().slice(0, 12) };
  });
  check("P11a a text line is visible after scrolling", visibleLine !== null, visibleLine);
  if (visibleLine) await page.touchscreen.tap(visibleLine.x, visibleLine.y);
  state = await expectState("P11 scroll then tap places caret in the tapped line", (s) =>
    s.selection === "text" && s.focused && visibleLine !== null && s.parentText.startsWith(visibleLine.text)
  );
  const widthsAfter = await Promise.all([0, 1, 2].map((index) => imageWidth(page, index)));
  check(
    "P11b scrolling resizes no image",
    widthsBefore.every((width, index) => Math.abs(width - widthsAfter[index]) < 2),
    { widthsBefore, widthsAfter }
  );

  // P12: intentional touch resize via the selected image's handle commits.
  await pictures.first().evaluate((picture) => picture.scrollIntoView({ block: "center" }));
  await page.touchscreen.tap(...center(await imageBox(page, 0)));
  const selectedForResize = await expectState("P12a tap image selects it for resizing", (s) => s.nodeName === "image" && s.visibleHandles === 2);
  const handleLocator = editor.locator('[data-node="image"]').first().locator('[data-resize-handle="right"]');
  const handle = (await handleLocator.count()) ? await handleLocator.boundingBox() : null;
  check("P12 selected image exposes a right handle", handle !== null, {
    handle,
    selectedForResize,
    editable: await editor.evaluate((root: HTMLElement & { editor: { isEditable: boolean } }) => root.editor.isEditable),
    handlesInDom: await editor.locator('[data-node="image"] [data-resize-handle]').count(),
  });
  if (handle) {
    const start = await imageWidth(page, 0);
    const from = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 };
    await touchDrag(cdp, from, { x: from.x - 120, y: from.y });
    await expect.poll(() => imageWidth(page, 0)).toBeLessThan(start - 60);
    state = await expectState("P12b touch resize ends (not stuck resizing)", (s) => s.resizing === 0);
    await expectState("P12d resized image stays selected with handles", (s) => s.nodeName === "image" && s.visibleHandles === 2);
    const resized = await imageWidth(page, 0);
    await touchDrag(cdp, { x: 215, y: 900 }, { x: 300, y: 900 });
    check("P12c later swipe does not keep resizing", Math.abs((await imageWidth(page, 0)) - resized) < 2, {
      resized,
      after: await imageWidth(page, 0),
    });
    await expect.poll(async () => {
      const response = await request.get(`/api/page?path=${encodeURIComponent(created.path)}`);
      return String(((await response.json()) as { page: { body: string } }).page.body);
    }).toMatch(/width="\d+(px)?"/);
    await page.screenshot({ path: path.join(shots, "mobile-after-touch-resize.png") });
  }

  // P13: after a resize, tapping away and typing must not replace the image.
  await page.touchscreen.tap(...center(await textBox(page, "Intro paragraph")));
  await expectState("P13a tap text after resize places caret", (s) => s.selection === "text" && s.parentText.startsWith("Intro"));
  await page.keyboard.type("Z");
  check("P13 type after resize keeps image", (await pictures.count()) === 3, await pictures.count());

  // P14: an image that is intentionally selected can be deleted.
  await page.touchscreen.tap(...center(await imageBox(page, 0)));
  await page.keyboard.press("Backspace");
  await expect.soft(pictures).toHaveCount(2);
  check("P14 Backspace deletes the selected image", (await pictures.count()) === 2, await pictures.count());

  fs.writeFileSync(path.join(shots, "mobile-image-matrix.json"), `${JSON.stringify(findings, null, 2)}\n`);
});

function center(box: { x: number; y: number; width: number; height: number }): [number, number] {
  return [box.x + box.width / 2, box.y + box.height / 2];
}
