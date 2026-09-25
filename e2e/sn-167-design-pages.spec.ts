import { test, expect, type APIRequestContext } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { ensureNotebookTreeVisible } from "./helpers";

// SAFE real-artifact fixture (acceptance-gating, SN-167). A ~3.8MB self-contained
// concept site with inline <style> — the exact class of artifact that does NOT
// survive the Tiptap pipeline and therefore needs the raw design render path.
const SAFE_FIXTURE = "C:/Projects/Safe/docs/design-system/Safe Switchgears Website (offline).html";
const SAFE_TITLE_MARKER = "Safe Switchgears";

const VAULT = path.resolve(__dirname, "..", ".e2e-vault");
const EVIDENCE_DIR = path.resolve(__dirname, "evidence", "SN-167");
const SECTION_PATH = "Personal Notebook/Quick Notes";

test.describe.configure({ mode: "serial" });

/** Parse width/height from a PNG IHDR chunk (bytes 16..24). */
function pngDimensions(buffer: Buffer): { width: number; height: number } {
  // PNG signature (8) + length (4) + "IHDR" (4) → width @16, height @20 (big-endian).
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

async function createDesignPage(
  request: APIRequestContext,
  title: string,
  body: string
): Promise<string> {
  const created = await request.post("/api/agent/vault", {
    data: { tool: "page_create", args: { sectionPath: SECTION_PATH, title, noteType: "design" } },
  });
  expect(created.ok(), `page_create failed: ${await created.text()}`).toBeTruthy();
  const createdJson = await created.json();
  const pagePath: string = createdJson.result.data.page.path;

  const written = await request.post("/api/agent/vault", {
    data: { tool: "page_write", args: { path: pagePath, body } },
  });
  expect(written.ok(), `page_write failed: ${await written.text()}`).toBeTruthy();
  return pagePath;
}

async function renderDesign(
  request: APIRequestContext,
  pagePath: string,
  viewport: "desktop" | "mobile"
) {
  const response = await request.post("/api/agent/vault", {
    data: { tool: "ui_render", args: { path: pagePath, viewport } },
  });
  expect(response.ok(), `ui_render (${viewport}) failed: ${await response.text()}`).toBeTruthy();
  const json = await response.json();
  return json.result.data as {
    absoluteDiskPath: string;
    vaultUrl: string;
    width: number;
    height: number;
    bytes: number;
  };
}

test("SN-167 desktop: SAFE artifact renders RAW as a design page at desktop and mobile", async ({
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Render pipeline is viewport-agnostic; run once.");
  // Server-side render launches a second headless Chromium against a cold dev
  // route and a multi-MB artifact — well beyond the default 60s test budget.
  test.setTimeout(300_000);
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });

  const safeHtml = await fs.readFile(SAFE_FIXTURE, "utf8");
  expect(safeHtml.length).toBeGreaterThan(100_000);
  expect(safeHtml).toContain("<style"); // inline CSS that Tiptap would strip

  const pagePath = await createDesignPage(request, `sn167-safe-${Date.now()}`, safeHtml);

  // Faithful storage: the raw artifact body is persisted verbatim (NOT normalized
  // to the Tiptap schema — <style>/<head> survive).
  const got = await request.post("/api/agent/vault", {
    data: { tool: "page_get", args: { path: pagePath } },
  });
  const gotBody: string = (await got.json()).result.data.page.body;
  expect(gotBody).toContain("<style");
  expect(gotBody).toContain(SAFE_TITLE_MARKER);

  // Desktop (1280) capture: non-empty PNG, width = 1280 * deviceScaleFactor(2),
  // and a tall page — proof real content rendered, not an empty Tiptap stub.
  const desktop = await renderDesign(request, pagePath, "desktop");
  expect(desktop.bytes).toBeGreaterThan(1000);
  expect(desktop.width).toBe(2560);
  expect(desktop.height).toBeGreaterThan(1800);
  const desktopBuffer = await fs.readFile(desktop.absoluteDiskPath);
  expect(desktopBuffer.byteLength).toBeGreaterThan(1000);
  expect(pngDimensions(desktopBuffer).width).toBe(2560);
  await fs.copyFile(desktop.absoluteDiskPath, path.join(EVIDENCE_DIR, "safe-desktop.png")).catch(() => undefined);

  // Mobile (390) capture: non-empty PNG at the mobile viewport width.
  const mobile = await renderDesign(request, pagePath, "mobile");
  expect(mobile.bytes).toBeGreaterThan(1000);
  expect(mobile.width).toBe(780);
  const mobileBuffer = await fs.readFile(mobile.absoluteDiskPath);
  expect(pngDimensions(mobileBuffer).width).toBe(780);
  await fs.copyFile(mobile.absoluteDiskPath, path.join(EVIDENCE_DIR, "safe-mobile.png")).catch(() => undefined);
});

test("SN-167 desktop: stylus annotation on a design page persists and composites into the capture", async ({
  page,
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop stylus workflow only");
  test.setTimeout(180_000);
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });

  // A small, fast design artifact with a distinctive marker.
  const title = `sn167-ink-${Date.now()}`;
  const body = [
    "<!doctype html><html><head><style>",
    "body{margin:0;font-family:sans-serif}.hero{height:1400px;background:linear-gradient(#eef,#fff);padding:40px}",
    "</style></head><body><section class=\"hero\"><h1 data-testid=\"art-hero\">Design artifact hero</h1></section></body></html>",
  ].join("");
  const pagePath = await createDesignPage(request, title, body);

  // Reload so the client picks up the freshly created design page, then open it.
  await page.goto("/");
  await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: 20000 });
  const tree = await ensureNotebookTreeVisible(page);
  const row = tree.getByText(title, { exact: true }).first();
  await expect(row).toBeVisible({ timeout: 15000 });
  await row.click();

  // The raw artifact renders in the isolated design frame (NOT Tiptap).
  const frame = page.getByTestId("design-page-frame");
  await expect(frame).toBeVisible({ timeout: 20000 });
  await expect(page.frameLocator('[data-testid="design-page-frame"]').getByTestId("art-hero")).toBeVisible({
    timeout: 15000,
  });

  // Toggle the stylus and draw a stroke over the live design. Wait for the
  // overlay to be in draw mode AND fully hydrated (tldraw editor mounted +
  // owner path established) before drawing — otherwise flush skips with
  // "skip-no-owner" and the stroke never reaches the sidecar.
  await page.getByTestId("design-pen-toggle").click();
  const layer = page.getByTestId("annotation-layer");
  await expect(layer).toBeVisible({ timeout: 15000 });
  await expect(layer).toHaveAttribute("data-annotation-mode", "draw", { timeout: 15000 });
  await expect(layer).toHaveAttribute("data-annotation-ready", "true", { timeout: 15000 });

  // The full draw toolbar (same control set as text/ink pages) is shown while
  // annotating — pen, eraser, select, undo/redo, colors, strokes, exit.
  await expect(page.getByTestId("design-draw-toolbar")).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId("ink-tool-eraser")).toBeVisible();
  await expect(page.getByTestId("ink-color-red")).toBeVisible();
  await expect(page.getByTestId("ink-stroke-l")).toBeVisible();
  const box = await layer.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width * 0.3, box!.y + box!.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width * 0.6, box!.y + box!.height * 0.5, { steps: 12 });
  await page.mouse.up();

  const savePromise = page
    .waitForResponse(
      (r) => r.url().includes("/api/annotations") && r.request().method() === "PUT" && r.status() === 200,
      { timeout: 20000 }
    )
    .catch(() => null);
  // Leaving draw mode (via the toolbar exit button) flushes the scene to the sidecar.
  await page.getByTestId("ink-exit-draw").click();
  await savePromise;

  // Ink persisted to the design page's annotation sidecar.
  const sidecarPath = path.join(VAULT, "Personal Notebook", "Quick Notes", `${title}.annotations.json`);
  await expect
    .poll(
      async () => {
        try {
          const raw = await fs.readFile(sidecarPath, "utf8");
          const payload = JSON.parse(raw) as {
            scene?: { document?: { store?: Record<string, { typeName?: string }> } };
          };
          const store = payload.scene?.document?.store ?? {};
          return Object.values(store).some((r) => r?.typeName === "shape");
        } catch {
          return false;
        }
      },
      { timeout: 20000 }
    )
    .toBe(true);

  // The annotated design still renders — the ink-composite path succeeds.
  const render = await renderDesign(request, pagePath, "desktop");
  expect(render.bytes).toBeGreaterThan(1000);
  await fs.copyFile(render.absoluteDiskPath, path.join(EVIDENCE_DIR, "annotated-design.png")).catch(() => undefined);
});

test("SN-167 desktop: owner can view/edit the raw artifact in the Source tab", async ({
  page,
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop owner-editing workflow only");
  test.setTimeout(120_000);

  const title = `sn167-source-${Date.now()}`;
  const marker = `owner-edit-marker-${Date.now()}`;
  const body = `<!doctype html><html><head><style>.b{padding:24px}</style></head><body><main class="b"><h1>${marker}</h1></main></body></html>`;
  await createDesignPage(request, title, body);

  await page.goto("/");
  await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: 20000 });
  const tree = await ensureNotebookTreeVisible(page);
  const row = tree.getByText(title, { exact: true }).first();
  await expect(row).toBeVisible({ timeout: 15000 });
  await row.click();

  // Default Preview tab renders the raw artifact.
  await expect(page.getByTestId("design-page-frame")).toBeVisible({ timeout: 20000 });

  // Source tab exposes the raw HTML/CSS body for direct owner editing (not Tiptap).
  await page.getByTestId("design-tab-source").click();
  const editor = page.getByTestId("design-source-editor");
  await expect(editor).toBeVisible({ timeout: 15000 });
  await expect(editor).toContainText(marker, { timeout: 15000 });
  await expect(editor).toContainText("<style>", { timeout: 15000 });

  // Switching back to Preview re-renders the isolated frame.
  await page.getByTestId("design-tab-preview").click();
  await expect(page.getByTestId("design-page-frame")).toBeVisible({ timeout: 15000 });
});

test("SN-167 desktop: companion write to an open design page surfaces reload and shows new content", async ({
  page,
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop reload workflow only");
  test.setTimeout(120_000);

  const title = `sn167-reload-${Date.now()}`;
  const markerA = `design-v1-${Date.now()}`;
  const markerB = `design-v2-${Date.now()}`;
  const bodyA = `<!doctype html><html><head><style>.p{padding:24px}</style></head><body><main class="p"><h1 data-testid="art-marker">${markerA}</h1></main></body></html>`;
  const bodyB = `<!doctype html><html><head><style>.p{padding:24px}</style></head><body><main class="p"><h1 data-testid="art-marker">${markerB}</h1></main></body></html>`;
  const pagePath = await createDesignPage(request, title, bodyA);

  await page.goto("/");
  await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: 20000 });
  const tree = await ensureNotebookTreeVisible(page);

  // Tree highlight: a design page carries the distinct "Design page" icon.
  await expect(tree.getByLabel("Design page").first()).toBeVisible({ timeout: 15000 });

  const row = tree.getByText(title, { exact: true }).first();
  await expect(row).toBeVisible({ timeout: 15000 });
  await row.click();

  const frame = page.frameLocator('[data-testid="design-page-frame"]');
  await expect(frame.getByTestId("art-marker")).toHaveText(markerA, { timeout: 20000 });

  // Simulate a companion edit: page_write new HTML while the page is open. This
  // emits file_updated, so the app should surface the reload affordance rather
  // than silently swap (or require a full browser refresh).
  const written = await request.post("/api/agent/vault", {
    data: { tool: "page_write", args: { path: pagePath, body: bodyB } },
  });
  expect(written.ok(), `page_write failed: ${await written.text()}`).toBeTruthy();

  // Header reload button (the rotate icon the owner uses) lights up for a
  // pending page update; the banner is a secondary affordance.
  const headerReload = page.getByTestId("reload-btn");
  await expect(headerReload).toBeEnabled({ timeout: 20000 });
  await expect(page.getByTestId("page-changed-reload-btn")).toBeVisible({ timeout: 20000 });
  // Prefer the header control — that's the button circled in review.
  await headerReload.click();

  // After reload the isolated frame shows the companion's new content — no full
  // page refresh needed (regression: the view previously kept the stale body).
  await expect(frame.getByTestId("art-marker")).toHaveText(markerB, { timeout: 20000 });
});

test("SN-167 desktop: design preview traps in-frame navigations (no Smart Notes inside iframe)", async ({
  page,
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop iframe link trap only");
  test.setTimeout(120_000);

  const title = `sn167-links-${Date.now()}`;
  const body = `<!doctype html><html><head><style>a{display:block;padding:24px}</style></head><body>
    <a data-testid="rel-link" href="/">Go home (relative)</a>
    <a data-testid="hash-link" href="#section">In-page</a>
    <h2 id="section">Section</h2>
  </body></html>`;
  await createDesignPage(request, title, body);

  await page.goto("/");
  await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: 20000 });
  const tree = await ensureNotebookTreeVisible(page);
  await tree.getByText(title, { exact: true }).first().click();

  const frameEl = page.getByTestId("design-page-frame");
  await expect(frameEl).toBeVisible({ timeout: 20000 });
  const frame = page.frameLocator('[data-testid="design-page-frame"]');
  await expect(frame.getByTestId("rel-link")).toBeVisible({ timeout: 15000 });

  // Clicking a relative app link must NOT navigate the iframe into Smart Notes.
  await frame.getByTestId("rel-link").click();
  await page.waitForTimeout(500);
  // Frame still shows the design artifact (link text), not the app shell.
  await expect(frame.getByTestId("rel-link")).toBeVisible({ timeout: 5000 });
  await expect(frame.getByTestId("app-shell")).toHaveCount(0);

  // In-page hash anchors still work.
  await frame.getByTestId("hash-link").click();
  await expect(frame.locator("#section")).toBeVisible();
});

test("SN-167 desktop: external direct-disk edit to an open design page is detected on resume", async ({
  page,
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop resume-detection workflow only");
  test.setTimeout(120_000);

  // Own-in-place: a design page's .html is a real file that an external agent /
  // editor may rewrite directly on disk — no vault API write, no chat_event. On
  // returning to the app the open design page must notice and offer reload.
  const title = `sn167-ext-${Date.now()}`;
  const markerA = `ext-v1-${Date.now()}`;
  const markerB = `ext-v2-${Date.now()}`;
  const mk = (marker: string) =>
    `<!doctype html><html><head><style>.p{padding:24px}</style></head><body><main class="p"><h1 data-testid="art-marker">${marker}</h1></main></body></html>`;
  const pagePath = await createDesignPage(request, title, mk(markerA));

  await page.goto("/");
  await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: 20000 });
  const tree = await ensureNotebookTreeVisible(page);
  const row = tree.getByText(title, { exact: true }).first();
  await expect(row).toBeVisible({ timeout: 15000 });
  await row.click();

  const frame = page.frameLocator('[data-testid="design-page-frame"]');
  await expect(frame.getByTestId("art-marker")).toHaveText(markerA, { timeout: 20000 });

  // Rewrite the file on disk directly (bypassing the vault API entirely).
  const onDisk = path.join(VAULT, pagePath);
  const raw = await fs.readFile(onDisk, "utf8");
  const frontmatterEnd = raw.indexOf("---", 3) + 3;
  await fs.writeFile(onDisk, `${raw.slice(0, frontmatterEnd)}\n${mk(markerB)}\n`, "utf8");

  // Simulate the owner returning to the tab — the resume handler re-checks the
  // open design page for external changes.
  await page.evaluate(() => {
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
  });

  // Header reload + banner both activate; click the header control.
  const headerReload = page.getByTestId("reload-btn");
  await expect(page.getByTestId("page-changed-reload-btn")).toBeVisible({ timeout: 20000 });
  await headerReload.click();
  await expect(frame.getByTestId("art-marker")).toHaveText(markerB, { timeout: 20000 });
});

test("SN-167 desktop: ink overlay stays pinned to the viewport while the design scrolls", async ({
  page,
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop scroll-alignment workflow only");
  test.setTimeout(120_000);

  // The ink overlay is `sticky top-0` and sized to the VIEWPORT; its Tldraw
  // camera pans by scrollTop. If it were instead sized to the full frame and
  // scrolled with the content, the camera-pan would double-count and ink would
  // drift out of alignment with the artifact. This regression asserts the
  // overlay host stays pinned to the viewport as the container scrolls.
  const title = `sn167-scroll-${Date.now()}`;
  const body = [
    "<!doctype html><html><head><style>",
    "body{margin:0;font-family:sans-serif}.hero{height:2400px;background:linear-gradient(#eef,#fff);padding:40px}",
    "</style></head><body><section class=\"hero\"><h1 data-testid=\"art-hero\">Tall design</h1></section></body></html>",
  ].join("");
  await createDesignPage(request, title, body);

  await page.goto("/");
  await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: 20000 });
  const tree = await ensureNotebookTreeVisible(page);
  await tree.getByText(title, { exact: true }).first().click();
  await expect(page.getByTestId("design-page-frame")).toBeVisible({ timeout: 20000 });

  // Enter draw mode so the ink overlay is mounted, hydrated, and visible.
  await page.getByTestId("design-pen-toggle").click();
  const layer = page.getByTestId("annotation-layer");
  await expect(layer).toHaveAttribute("data-annotation-ready", "true", { timeout: 15000 });

  const scroller = page.getByTestId("design-scroll");
  const topBefore = (await layer.boundingBox())!.y;

  // Scroll the design container; the sticky overlay must not scroll away with it.
  await scroller.evaluate((el) => {
    (el as HTMLElement).scrollTop = 800;
  });
  await expect
    .poll(async () => scroller.evaluate((el) => (el as HTMLElement).scrollTop))
    .toBe(800);
  // Let the sticky reflow + camera sync settle.
  await page.waitForTimeout(200);

  const topAfter = (await layer.boundingBox())!.y;

  // Sticky pins the overlay to the viewport: its top barely moves even though
  // the content scrolled 800px. (Pre-fix, an absolute full-height overlay moved
  // by ~800px.) The Tldraw camera follows the scroll to keep ink aligned.
  expect(Math.abs(topAfter - topBefore)).toBeLessThan(8);
  // The Tldraw camera followed the scroll (so ink tracks content, not the viewport).
  await expect
    .poll(async () => Number(await layer.getAttribute("data-annotation-camera-scroll-top")), { timeout: 5000 })
    .toBeGreaterThan(700);
});
