import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { dismissBlockingOverlays } from "./helpers";

const SECTION = "Personal Notebook/Quick Notes";
const HOME_NOTEBOOK = "Personal Notebook";
const EVIDENCE_DIR = path.resolve(__dirname, "evidence", "SN-303");
const PDF_FIXTURE = path.resolve(__dirname, "fixtures/catalogue-final.pdf");
const SLOW = { timeout: 60_000 };
const ANSWER = "A right angle post clamp joins two posts at 90 degrees.";

test.use({ serviceWorkers: "block" });

/** Deterministic shared-sidebar turn with the existing dev chat-event bridge. */
async function stubFastLane(page: Page, bodies: string[]) {
  await page.route("**/api/chat/send", async (route) => {
    bodies.push(route.request().postData() ?? "");
    const { turn_id: turnId } = JSON.parse(bodies[bodies.length - 1]) as { turn_id: string };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ turn_id: turnId }) });
    await page.evaluate(({ turnId, answer }) => {
      const bridge = (window as typeof window & { __testChatBridge?: { injectChatEvent: (event: unknown) => void } }).__testChatBridge;
      bridge?.injectChatEvent({ turn_id: turnId, seq: 0, type: "token", payload: { text: answer } });
      bridge?.injectChatEvent({ turn_id: turnId, seq: 1, type: "done", payload: { status: "completed" } });
    }, { turnId, answer: ANSWER });
  });
}

async function vault(page: Page, tool: string, args: Record<string, unknown>) {
  const res = await page.request.post("/api/agent/vault", { data: { tool, args } });
  expect(res.ok(), `${tool}: ${await res.text()}`).toBe(true);
  const json = await res.json() as { result?: { data?: { page?: { path?: string } } } };
  return json.result?.data?.page?.path ?? "";
}

async function shot(page: Page, project: string, name: string) {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  await page.screenshot({ path: path.join(EVIDENCE_DIR, `${project}-${name}.png`) });
}

async function askAndContinue(page: Page, project: string, surface: string, bodies: string[]) {
  const popover = page.getByTestId("ask-companion-popover");
  await expect(popover).toHaveAttribute("role", "dialog");
  await expect(popover.getByText("Uses full page text and table context. Images, ink, and linked files are not read.")).toBeVisible();
  await expect(popover.getByText("Selection and surrounding page context are sent.")).toBeVisible();
  await expect(popover.getByPlaceholder("What does this mean?")).toBeFocused();
  await shot(page, project, `${surface}-popover`);
  await popover.getByRole("button", { name: "Explain" }).click();
  await popover.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(popover.getByText(ANSWER)).toBeVisible();
  const box = await popover.boundingBox();
  const viewport = page.viewportSize()!;
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
  await shot(page, project, `${surface}-answer`);
  const body = JSON.parse(bodies[bodies.length - 1]) as { message: string; thread_key: string };
  expect(body.message).toContain(`"surface":"${surface}"`);
  expect(body.thread_key).toBeTruthy();
  await popover.getByRole("button", { name: "Open in Companion →" }).click();
  await expect(popover).toHaveCount(0);
  const companion = project === "mobile" ? page.getByTestId("mobile-ai-sheet") : page.getByTestId("ai-sidebar");
  await expect(companion).toBeVisible(SLOW);
  await expect(companion.getByText(ANSWER)).toBeVisible(SLOW);
}

async function openAskMenuFromFrame(page: Page, frameTestId: string, text: string, project: string, surface: string) {
  const host = page.getByTestId(frameTestId);
  await expect(host).toBeVisible(SLOW);
  const frame = page.frameLocator(`[data-testid="${frameTestId}"]`);
  const target = frame.getByText(text);
  await expect(target).toBeVisible(SLOW);
  if (project === "mobile") {
    // Exercise the injected frame shim's touch hold path, not a synthetic right-click.
    await target.dispatchEvent("pointerdown", { pointerType: "touch", clientX: 24, clientY: 24 });
    await page.waitForTimeout(700);
    await target.dispatchEvent("pointerup", { pointerType: "touch", clientX: 24, clientY: 24 });
  } else {
    await target.click({ button: "right" });
  }
  const popover = page.getByTestId("ask-companion-popover");
  await expect(popover.getByRole("menuitem", { name: /Ask Companion/ })).toBeVisible(SLOW);
  await shot(page, project, `${surface}-menu`);
  await popover.getByRole("menuitem", { name: /Ask Companion/ }).click();
  await expect(popover.locator("blockquote")).toHaveText(text);
  return popover;
}

test("SN-303: text page context menu row, table menu row, popover, and Continue in Companion", async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const project = testInfo.project.name;
  const bodies: string[] = [];
  await stubFastLane(page, bodies);
  const pagePath = await vault(page, "page_create", {
    sectionPath: SECTION, title: `SN-303 Post system ${project} ${Date.now()}`,
    content: "<p>Right angle post clamp</p><table><tbody><tr><th><p>Part</p></th><th><p>Qty</p></th></tr><tr><td><p>Clamp</p></td><td><p>4</p></td></tr></tbody></table><p>After table</p>",
  });
  try {
    await page.goto(`/?page=${encodeURIComponent(pagePath)}`);
    await dismissBlockingOverlays(page);
    const editor = page.getByTestId("rich-text-editor");
    await expect(editor.getByText("Right angle post clamp")).toBeVisible(SLOW);

    // Table menu (SN-308) keeps its actions and gains the same final row.
    await editor.locator("td").filter({ hasText: "Clamp" }).click({ button: "right" });
    const menu = page.getByTestId("editor-context-menu");
    await expect(menu).toHaveAttribute("data-menu-kind", "table");
    await expect(menu.getByTestId("ctx-ask-companion")).toBeVisible();
    await shot(page, project, "table-menu");
    await page.keyboard.press("Escape");

    await editor.getByText("Right angle post clamp").click({ button: "right" });
    await expect(menu).toHaveAttribute("data-menu-kind", "text");
    await expect(menu.getByRole("menuitem", { name: "Format" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Turn into" })).toBeVisible();
    const last = menu.getByRole("menuitem").last();
    await expect(last).toHaveText(/Ask Companion\.\.\./);
    await shot(page, project, "text-menu");
    await last.click();
    const popover = page.getByTestId("ask-companion-popover");
    await expect(popover.getByText("Clicked paragraph")).toBeVisible();
    await expect(popover.locator("blockquote")).toHaveText("Right angle post clamp");
    await askAndContinue(page, project, "text", bodies);
    const sent = JSON.parse(bodies[0]) as { message: string };
    expect(sent.message).toContain("Clamp");
  } finally {
    await page.request.delete(`/api/page?path=${encodeURIComponent(pagePath)}`).catch(() => undefined);
  }
});

test("SN-303: mobile selection bubble opens Ask Companion", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "Selection bubble is the mobile entry path.");
  test.setTimeout(120_000);
  const bodies: string[] = [];
  await stubFastLane(page, bodies);
  const pagePath = await vault(page, "page_create", {
    sectionPath: SECTION,
    title: `SN-303 Bubble ${Date.now()}`,
    content: "<p>After table selection target</p>",
  });
  try {
    await page.goto(`/?page=${encodeURIComponent(pagePath)}`);
    await dismissBlockingOverlays(page);
    const editor = page.getByTestId("rich-text-editor");
    await expect(editor.getByText("After table selection target")).toBeVisible(SLOW);
    await editor.click();
    await page.keyboard.press("Control+A");
    const bubble = page.getByTestId("bubble-ask-companion");
    await expect(bubble).toBeVisible(SLOW);
    await shot(page, "mobile", "text-bubble");
    await bubble.click();
    await expect(page.getByTestId("ask-companion-popover").locator(".inline-ai-target")).toHaveText("Selection");
    await shot(page, "mobile", "text-bubble-popover");
    await askAndContinue(page, "mobile", "text", bodies);
    const sent = JSON.parse(bodies[0]) as { message: string };
    expect(sent.message).toContain('"target":"Selection"');
    expect(sent.message).toContain("After table selection target");
  } finally {
    await page.request.delete(`/api/page?path=${encodeURIComponent(pagePath)}`).catch(() => undefined);
  }
});

test("SN-303: design page frame forwards right-click to the host popover", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const project = testInfo.project.name;
  const bodies: string[] = [];
  await stubFastLane(page, bodies);
  const pagePath = await vault(page, "page_create", { sectionPath: SECTION, title: `SN-303 Design ${project} ${Date.now()}`, noteType: "design" });
  expect(pagePath).toBeTruthy();
  await vault(page, "page_write", { path: pagePath, body: "<main style=\"padding:24px;font-family:system-ui\"><h1>Clamp concept</h1><p>Design paragraph about the clamp.</p></main>" });
  try {
    await page.goto(`/?page=${encodeURIComponent(pagePath)}`);
    await dismissBlockingOverlays(page);
    await expect(page.getByTestId("design-page-frame")).toBeVisible(SLOW);
    await openAskMenuFromFrame(page, "design-page-frame", "Design paragraph about the clamp.", project, "design");
    await askAndContinue(page, project, "design", bodies);
  } finally {
    await page.request.delete(`/api/page?path=${encodeURIComponent(pagePath)}`).catch(() => undefined);
  }
});

test("SN-303: sandboxed App page invokes through the nonce bridge without same-origin", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const project = testInfo.project.name;
  const bodies: string[] = [];
  await stubFastLane(page, bodies);
  const appPath = await vault(page, "app_create_from_template", { sectionPath: SECTION, templateId: "blank-app", title: `SN-303 App ${project} ${Date.now()}` });
  expect(appPath).toBeTruthy();
  await vault(page, "app_update", {
    path: appPath,
    source: "<main style=\"padding:16px;font-family:system-ui\"><h1>Clamp tracker</h1><p id=\"note\">App paragraph about clamps.</p></main>",
  });
  try {
    await page.goto(`/?page=${encodeURIComponent(appPath)}`);
    await dismissBlockingOverlays(page);
    await expect(page.getByTestId("app-page-view")).toBeVisible(SLOW);
    // Bootstrap / srcDoc remount can trip the heartbeat watchdog; recover and wait until the frame stays up.
    const frame = page.getByTestId("app-page-frame");
    await expect.poll(async () => {
      if (await page.getByText("App runtime stopped").isVisible().catch(() => false)) {
        await page.getByRole("button", { name: /Recover and reload/ }).click();
        await page.waitForTimeout(500);
      }
      return frame.isVisible();
    }, SLOW).toBe(true);
    expect(await frame.getAttribute("sandbox")).not.toContain("allow-same-origin");
    await openAskMenuFromFrame(page, "app-page-frame", "App paragraph about clamps.", project, "app");
    // A forged message from the host window (wrong source window / nonce) is ignored.
    await page.keyboard.press("Escape");
    await page.evaluate(() => window.postMessage({ source: "smart-notes-app-frame", nonce: "forged", kind: "ask-companion", x: 5, y: 5, context: { surface: "app", target: "Selection", text: "x", pageText: "", tableText: "" } }, "*"));
    await page.waitForTimeout(300);
    await expect(page.getByTestId("ask-companion-popover")).toHaveCount(0);
    await openAskMenuFromFrame(page, "app-page-frame", "App paragraph about clamps.", project, "app");
    await askAndContinue(page, project, "app", bodies);
  } finally {
    await page.request.delete(`/api/page?path=${encodeURIComponent(appPath)}`).catch(() => undefined);
  }
});

test("SN-303: PDF reader right-click captures engine text for the visible page", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const project = testInfo.project.name;
  const bodies: string[] = [];
  await stubFastLane(page, bodies);
  const created = await page.request.post("/api/papers", {
    data: { title: `SN-303 Paper ${project} ${Date.now()}`, homeNotebookPath: HOME_NOTEBOOK },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const paper = (await created.json()).page as { path: string };
  try {
    const upload = await page.request.post(`/api/assets?path=${encodeURIComponent(paper.path)}`, {
      multipart: { file: { name: "Catalogue(Final).pdf", mimeType: "application/pdf", buffer: fs.readFileSync(PDF_FIXTURE) } },
    });
    expect(upload.ok(), await upload.text()).toBe(true);
    const href = (await upload.json()).asset.url as string;
    await page.request.put("/api/page", { data: { path: paper.path, title: "SN-303 Paper", content:
      `<p><span data-file-attachment="" data-file-type="pdf" class="file-attachment-chip file-attachment-chip--pdf" contenteditable="false" href="${href}" fileName="Catalogue(Final).pdf"><span class="file-attachment-icon" aria-hidden="true">PDF</span><span class="file-attachment-name" data-href="${href}">Catalogue(Final).pdf</span></span></p>` } });
    await page.goto(`/?page=${encodeURIComponent(paper.path)}`);
    await dismissBlockingOverlays(page);
    await expect(page.getByTestId("paper-ownership")).toBeVisible(SLOW);
    await page.locator('[data-file-type="pdf"]').first().click();
    const pageFrame = page.locator(".pdf-reader__page-frame").first();
    await expect(pageFrame).toBeVisible(SLOW);
    await expect(page.getByTestId("pdf-reader-page-total")).toContainText("/ 3", SLOW);
    const box = (await pageFrame.boundingBox())!;
    await pageFrame.click({ button: "right", position: { x: box.width / 3, y: Math.min(box.height / 3, 200) } });
    const popover = page.getByTestId("ask-companion-popover");
    await expect(popover.getByRole("menuitem", { name: /Ask Companion/ })).toBeVisible(SLOW);
    await shot(page, project, "pdf-menu");
    await popover.getByRole("menuitem", { name: /Ask Companion/ }).click();
    await expect(popover.getByText("PDF page")).toBeVisible();
    await askAndContinue(page, project, "pdf", bodies);
  } finally {
    await page.request.delete(`/api/page?path=${encodeURIComponent(paper.path)}`).catch(() => undefined);
  }
});
