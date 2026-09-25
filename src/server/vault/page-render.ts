import {
  isDevRuntime,
  resolvePublicServerBaseUrl,
  resolveRenderServerBaseUrl,
} from "@/server/render-server-url";
import { uploadPageAsset } from "@/server/vault/assets";
import { VaultError } from "@/server/vault/errors";
import { readPage } from "@/server/vault/pages";
import { resolveVaultPath } from "@/server/vault/paths";
import { issueRenderToken } from "@/server/vault/page-render-token";

export interface PageRenderOptions {
  pagePath: string;
  scale?: number;
  fullPage?: boolean;
  outputName?: string;
  /**
   * Chromium viewport width in CSS px (SN-167). Drives responsive media queries
   * for raw-HTML design renders. Defaults to the desktop preset.
   */
  viewportWidth?: number;
}

export interface LogFormRenderOptions extends PageRenderOptions {}

/** Named viewport presets for design-page (note_type=design) captures (SN-167). */
export const UI_RENDER_VIEWPORTS = {
  desktop: 1280,
  mobile: 390,
} as const;

export type UiRenderViewport = keyof typeof UI_RENDER_VIEWPORTS;

/** Resolve a viewport width from an explicit px value or a named preset. */
export function resolveUiViewportWidth(
  value: number | UiRenderViewport | undefined
): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.min(Math.max(Math.round(value), 240), 4096);
  }
  if (value === "mobile") return UI_RENDER_VIEWPORTS.mobile;
  return UI_RENDER_VIEWPORTS.desktop;
}

export interface PageRenderWarning {
  code: "missing_asset";
  detail: string;
}

export interface PageRenderResult {
  relativePath: string;
  vaultUrl: string;
  /** Absolute URL for the PNG (loopback in preview; attach for vision review). */
  absoluteVaultUrl: string;
  /** Absolute filesystem path to the PNG — use with the Read tool for vision. */
  absoluteDiskPath: string;
  width: number;
  height: number;
  bytes: number;
  warnings: PageRenderWarning[];
}

/** Map broken image sources (naturalWidth===0) to structured missing-asset warnings. */
export function mapBrokenImagesToWarnings(srcs: readonly string[]): PageRenderWarning[] {
  return srcs.map((src) => ({
    code: "missing_asset" as const,
    detail: `Image failed to load and rendered as a placeholder: ${src || "(unknown src)"}`,
  }));
}

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {
    throw new VaultError(
      "RENDER_UNAVAILABLE",
      "Playwright is not installed. Run `npx playwright install chromium` in the project root, then retry page_render / rr.",
      503
    );
  }
}

export async function renderPageToPng(options: PageRenderOptions): Promise<PageRenderResult> {
  const pagePath = options.pagePath;
  await readPage(pagePath);

  const scale = options.scale ?? 2;
  const fullPage = options.fullPage ?? true;
  const outputName = options.outputName?.trim() || "page-render-latest.png";

  if (!Number.isFinite(scale) || scale <= 0 || scale > 4) {
    throw new VaultError("INVALID_INPUT", '"scale" must be a number between 0 and 4.', 400);
  }

  const baseUrl = resolveRenderServerBaseUrl();
  const publicBaseUrl = resolvePublicServerBaseUrl();
  const token = issueRenderToken(pagePath);
  const renderUrl = `${baseUrl}/render/page?path=${encodeURIComponent(pagePath)}&token=${token}`;
  const devRuntime = isDevRuntime();
  // Preview inspect runs `npm run dev` with HMR websockets — `networkidle` never
  // settles. First `/render/page` compile in dev can exceed 45s on cold start.
  const navigationTimeout = devRuntime ? 120_000 : 60_000;
  const readyTimeout = devRuntime ? 90_000 : 45_000;

  const { chromium } = await loadPlaywright();
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;

  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
      deviceScaleFactor: scale,
      viewport: { width: 1280, height: 900 },
    });

    const response = await page.goto(renderUrl, {
      waitUntil: "domcontentloaded",
      timeout: navigationTimeout,
    });
    if (!response || !response.ok()) {
      throw new VaultError(
        "RENDER_FAILED",
        `Render route returned HTTP ${response?.status() ?? "unknown"}. Is the Smart Notes server running at ${baseUrl}?`,
        502
      );
    }

    await page.waitForSelector('[data-page-render-ready="true"]', { timeout: readyTimeout });
    await page.locator('[data-testid="page-render-root"]').waitFor({
      state: "visible",
      timeout: 10_000,
    });

    // Measure the full document + render-root so we can capture the whole
    // extended page (text column plus ink margin) with a fixed-size viewport
    // instead of Playwright's `fullPage` path. The Tldraw canvas repaints
    // continuously, which makes both `locator.screenshot()` (element-stability
    // wait) and `page.screenshot({ fullPage })` (viewport resize + reflow loop)
    // hang; a bounded viewport + clip is deterministic.
    const metrics = await page.evaluate(() => {
      const root = document.querySelector('[data-testid="page-render-root"]') as HTMLElement | null;
      return {
        rootHeight: root?.offsetHeight ?? 0,
        docHeight: Math.max(
          document.documentElement.scrollHeight,
          document.body?.scrollHeight ?? 0
        ),
        docWidth: Math.max(
          document.documentElement.scrollWidth,
          document.body?.scrollWidth ?? 0
        ),
      };
    });

    const captureHeight = fullPage
      ? Math.min(Math.ceil(Math.max(metrics.docHeight, metrics.rootHeight)) + 8, 16_384)
      : 900;
    const captureWidth = Math.min(Math.ceil(Math.max(metrics.docWidth, 1280)), 4096);

    // Broken images (missing local .assets/ files or failed remote loads) render
    // as placeholders rather than failing the capture. Report them structured so
    // the caller can explain the gap instead of guessing.
    const brokenImageSrcs = await page.evaluate(() =>
      Array.from(document.images)
        // Only real asset references that failed to load — skip empty/srcless
        // decorative or placeholder <img> elements (not a "missing asset").
        .filter((img) => img.complete && img.naturalWidth === 0 && (img.getAttribute("src") ?? "").trim() !== "")
        .map((img) => img.getAttribute("src") as string)
    );
    const warnings = mapBrokenImagesToWarnings(brokenImageSrcs);

    await page.setViewportSize({ width: captureWidth, height: captureHeight });
    // One frame for the ink camera to re-sync to the resized viewport.
    await page.waitForTimeout(150);

    const pngBuffer = await page.screenshot({
      type: "png",
      animations: "disabled",
      clip: { x: 0, y: 0, width: captureWidth, height: captureHeight },
    });

    const asset = await uploadPageAsset(pagePath, outputName, Buffer.from(pngBuffer), {
      overwrite: true,
    });

    return {
      relativePath: asset.path,
      vaultUrl: asset.url,
      absoluteVaultUrl: `${publicBaseUrl}${asset.url}`,
      absoluteDiskPath: resolveVaultPath(asset.path, "section").absolutePath,
      width: Math.round(captureWidth * scale),
      height: Math.round(captureHeight * scale),
      bytes: pngBuffer.byteLength,
      warnings,
    };
  } catch (error) {
    if (error instanceof VaultError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new VaultError(
      "RENDER_FAILED",
      `Page render failed: ${message}`,
      502
    );
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

/** Capture the focused Form UI for a log page; text-page rendering is not useful for log stubs. */
export async function renderLogFormToPng(options: LogFormRenderOptions): Promise<PageRenderResult> {
  const page = await readPage(options.pagePath);
  if (page.metadata.note_type !== "log") {
    throw new VaultError("INVALID_INPUT", "log_form_render requires a log page.", 400);
  }
  const scale = options.scale ?? 2;
  const outputName = options.outputName?.trim() || "log-form-render-latest.png";
  if (!Number.isFinite(scale) || scale <= 0 || scale > 4) {
    throw new VaultError("INVALID_INPUT", '"scale" must be a number between 0 and 4.', 400);
  }

  const baseUrl = resolveRenderServerBaseUrl();
  const publicBaseUrl = resolvePublicServerBaseUrl();
  const token = issueRenderToken(page.path);
  const renderUrl = `${baseUrl}/render/log?path=${encodeURIComponent(page.path)}&token=${token}`;
  const devRuntime = isDevRuntime();
  const navigationTimeout = devRuntime ? 120_000 : 60_000;
  const readyTimeout = devRuntime ? 90_000 : 45_000;
  const { chromium } = await loadPlaywright();
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;

  try {
    browser = await chromium.launch({ headless: true });
    const browserPage = await browser.newPage({ deviceScaleFactor: scale, viewport: { width: 1280, height: 900 } });
    const response = await browserPage.goto(renderUrl, { waitUntil: "domcontentloaded", timeout: navigationTimeout });
    if (!response?.ok()) throw new VaultError("RENDER_FAILED", `Log render route returned HTTP ${response?.status() ?? "unknown"}.`, 502);
    await browserPage.waitForSelector('[data-log-render-ready="true"]', { timeout: readyTimeout });
    await browserPage.locator('[data-testid="log-form"]').waitFor({ state: "visible", timeout: readyTimeout });
    const metrics = await browserPage.evaluate(() => ({
      height: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight, 900),
      width: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth, 1280),
    }));
    const captureWidth = Math.min(Math.ceil(Math.max(metrics.width, 1280)), 4096);
    const captureHeight = Math.min(Math.ceil(Math.max(metrics.height, 900)), 8192);
    const pngBuffer = await browserPage.screenshot({ type: "png", clip: { x: 0, y: 0, width: captureWidth, height: captureHeight } });
    const asset = await uploadPageAsset(page.path, outputName, Buffer.from(pngBuffer), { overwrite: true });
    return {
      relativePath: asset.path,
      vaultUrl: asset.url,
      absoluteVaultUrl: `${publicBaseUrl}${asset.url}`,
      absoluteDiskPath: resolveVaultPath(asset.path, "section").absolutePath,
      width: Math.round(captureWidth * scale),
      height: Math.round(captureHeight * scale),
      bytes: pngBuffer.byteLength,
      warnings: [],
    };
  } catch (error) {
    if (error instanceof VaultError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new VaultError("RENDER_FAILED", `Log Form render failed: ${message}`, 502);
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

export interface UiRenderOptions extends PageRenderOptions {
  /** Named preset ("desktop" | "mobile") or an explicit width; wins over viewportWidth. */
  viewport?: UiRenderViewport | number;
}

/**
 * Capture a design page (note_type=design) — its body is rendered RAW in an
 * isolated frame at a chosen viewport width so real CSS + media queries apply
 * faithfully (SN-167). Ink annotations composited via the shared render route.
 */
export async function renderUiToPng(options: UiRenderOptions): Promise<PageRenderResult> {
  const page = await readPage(options.pagePath);
  if (page.metadata.note_type !== "design") {
    throw new VaultError("INVALID_INPUT", "ui_render requires a design page (note_type=design).", 400);
  }
  const scale = options.scale ?? 2;
  const viewportWidth = resolveUiViewportWidth(options.viewport ?? options.viewportWidth);
  const isMobile = viewportWidth <= UI_RENDER_VIEWPORTS.mobile;
  const outputName =
    options.outputName?.trim() ||
    `ui-render-${isMobile ? "mobile" : "desktop"}-latest.png`;
  if (!Number.isFinite(scale) || scale <= 0 || scale > 4) {
    throw new VaultError("INVALID_INPUT", '"scale" must be a number between 0 and 4.', 400);
  }

  const baseUrl = resolveRenderServerBaseUrl();
  const publicBaseUrl = resolvePublicServerBaseUrl();
  const token = issueRenderToken(page.path);
  const renderUrl = `${baseUrl}/render/ui?path=${encodeURIComponent(page.path)}&token=${token}&viewportWidth=${viewportWidth}`;
  const devRuntime = isDevRuntime();
  const navigationTimeout = devRuntime ? 120_000 : 60_000;
  const readyTimeout = devRuntime ? 90_000 : 45_000;
  const { chromium } = await loadPlaywright();
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;

  try {
    browser = await chromium.launch({ headless: true });
    const browserPage = await browser.newPage({
      deviceScaleFactor: scale,
      viewport: { width: viewportWidth, height: 900 },
    });
    const response = await browserPage.goto(renderUrl, {
      waitUntil: "domcontentloaded",
      timeout: navigationTimeout,
    });
    if (!response?.ok()) {
      throw new VaultError(
        "RENDER_FAILED",
        `UI render route returned HTTP ${response?.status() ?? "unknown"}. Is the Smart Notes server running at ${baseUrl}?`,
        502
      );
    }
    await browserPage.waitForSelector('[data-ui-render-ready="true"]', { timeout: readyTimeout });
    await browserPage.locator('[data-testid="ui-render-root"]').waitFor({
      state: "visible",
      timeout: readyTimeout,
    });

    // The raw artifact + ink overlay define their own height; measure the render
    // root so a bounded viewport + clip captures the whole frame deterministically
    // (tldraw repaint makes fullPage/locator screenshots hang — see SN-122).
    const metrics = await browserPage.evaluate(() => {
      const root = document.querySelector('[data-testid="ui-render-root"]') as HTMLElement | null;
      return {
        rootHeight: root?.offsetHeight ?? 0,
        docHeight: Math.max(
          document.documentElement.scrollHeight,
          document.body?.scrollHeight ?? 0
        ),
      };
    });
    const captureWidth = viewportWidth;
    const captureHeight = Math.min(
      Math.ceil(Math.max(metrics.docHeight, metrics.rootHeight, 900)) + 8,
      16_384
    );

    await browserPage.setViewportSize({ width: captureWidth, height: captureHeight });
    await browserPage.waitForTimeout(150);

    const pngBuffer = await browserPage.screenshot({
      type: "png",
      animations: "disabled",
      clip: { x: 0, y: 0, width: captureWidth, height: captureHeight },
    });
    const asset = await uploadPageAsset(page.path, outputName, Buffer.from(pngBuffer), {
      overwrite: true,
    });
    return {
      relativePath: asset.path,
      vaultUrl: asset.url,
      absoluteVaultUrl: `${publicBaseUrl}${asset.url}`,
      absoluteDiskPath: resolveVaultPath(asset.path, "section").absolutePath,
      width: Math.round(captureWidth * scale),
      height: Math.round(captureHeight * scale),
      bytes: pngBuffer.byteLength,
      warnings: [],
    };
  } catch (error) {
    if (error instanceof VaultError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new VaultError("RENDER_FAILED", `UI render failed: ${message}`, 502);
  } finally {
    await browser?.close().catch(() => undefined);
  }
}
