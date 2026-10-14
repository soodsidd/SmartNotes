import { test, expect, type APIRequestContext } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { ensureNotebookTreeVisible } from "./helpers";

const FIXTURE = path.resolve(__dirname, "fixtures", "sn-304-resume-template.html");
const EVIDENCE = path.resolve(__dirname, "evidence", "SN-304");

async function createDesign(request: APIRequestContext, title: string, body: string) {
  const created = await request.post("/api/agent/vault", {
    data: { tool: "page_create", args: { sectionPath: "Personal Notebook/Quick Notes", title, noteType: "design" } },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const pagePath = (await created.json()).result.data.page.path as string;
  const written = await request.post("/api/agent/vault", { data: { tool: "page_write", args: { path: pagePath, body } } });
  expect(written.ok(), await written.text()).toBeTruthy();
  return pagePath;
}

test("SN-304: real resume template edits verbatim, shows A4 guides, and exports A4 PDF", async ({ page, request }, testInfo) => {
  test.setTimeout(300_000);
  const original = (await fs.readFile(FIXTURE, "utf8"))
    .replaceAll("{{ name }}", "Leo Test")
    .replace("{{ profile_paragraph }}", "A4 preview layout. ".repeat(420));
  const title = `sn304-resume-${testInfo.project.name}-${Date.now()}`;
  const pagePath = await createDesign(request, title, original);
  // Baseline is the stored body (the vault normalizes the file ending on write).
  const stored = (await (await request.get(`/api/page?path=${encodeURIComponent(pagePath)}`)).json()).page.body as string;
  expect(stored.trimEnd()).toBe(original.trimEnd());

  await page.goto("/");
  await expect(page.getByTestId("app-shell")).toBeVisible();
  const tree = await ensureNotebookTreeVisible(page);
  await tree.getByText(title, { exact: true }).first().click();
  const frame = page.frameLocator('[data-testid="design-page-frame"]');
  // First open compiles the design view chunk on the dev server.
  await expect(frame.locator(".resume h1")).toHaveText("Leo Test", { timeout: 60_000 });

  await page.getByTestId("design-page-layout").click();
  await expect(page.getByTestId("design-page-break").first()).toBeVisible();
  const guideCount = await page.getByTestId("design-page-break").count();
  const pageCount = guideCount + 1;
  await expect(page.getByTestId("design-page-count")).toHaveText(`${pageCount} pages`);
  await fs.mkdir(EVIDENCE, { recursive: true });
  await page.getByTestId("design-page-break").first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(EVIDENCE, `${testInfo.project.name}-guides.png`) });

  await frame.locator(".resume h1").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Edited");
  await expect(frame.locator(".resume h1")).toHaveText("Leo Test Edited");
  await expect.poll(async () => {
    const response = await request.get(`/api/page?path=${encodeURIComponent(pagePath)}`);
    return (await response.json()).page.body as string;
  }, { timeout: 20_000 }).toBe(stored.replace("<h1>Leo Test</h1>", "<h1>Leo Test Edited</h1>"));

  await page.getByTestId("design-max-pages").fill("1");
  await expect(page.getByTestId("design-page-warning")).toBeVisible();
  const latest = await (await request.get(`/api/page?path=${encodeURIComponent(pagePath)}`)).json();
  const exported = await request.post("/api/design/pdf", { data: { path: pagePath, bodyHtml: latest.page.body } });
  expect(exported.ok(), await exported.text()).toBeTruthy();
  expect(exported.headers()["content-type"]).toContain("application/pdf");
  const bytes = await exported.body();
  expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
  const pdf = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: true }).promise;
  expect(pdf.numPages).toBe(Number(exported.headers()["x-design-page-count"]));
  const size = (await pdf.getPage(1)).getViewport({ scale: 1 });
  // A4 is 595.28 x 841.89pt; Chromium rounds paper dimensions by under 1pt.
  expect(Math.abs(size.width - 595.28)).toBeLessThan(1);
  expect(Math.abs(size.height - 841.89)).toBeLessThan(1);
  expect(pdf.numPages).toBe(pageCount);
  await pdf.destroy();
});
