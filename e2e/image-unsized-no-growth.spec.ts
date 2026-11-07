import { expect, test } from "@playwright/test";
import { PNG } from "pngjs";
import fs from "node:fs";
import path from "node:path";

function png(width: number, height: number) {
  const image = new PNG({ width, height });
  image.data.fill(180);
  const name = `probe-${width}x${height}.png`;
  fs.writeFileSync(path.resolve(__dirname, "../.e2e-vault", name), PNG.sync.write(image));
  return `/vault/${name}`;
}

test.use({ serviceWorkers: "block" });

// Owner-critical defect: unsized images crept wider on every visit because the
// editor width followed the image and the image followed the editor.
test("unsized images stay at the reading column and never keep growing", async ({ page, request }, testInfo) => {
  test.setTimeout(120_000);
  const small = png(300, 200);
  const big = png(1800, 300);
  const title = `growth-probe-${Date.now()}`;
  const created = await request.post("/api/page", { data: { notebookPath: "Personal Notebook", sectionPath: "Personal Notebook/Quick Notes", title } });
  const { page: saved } = await created.json() as { page: { path: string } };
  const body = [
    `<p>Unsized small <img class="editor-image" src="${small}" alt="u-small"></p>`,
    `<p>Unsized big <img class="editor-image" src="${big}" alt="u-big"></p>`,
    `<p>Px <img class="editor-image" src="${small}" alt="px" width="240px" style="width: 240px; height: auto;"></p>`,
    `<p>Pct <img class="editor-image" src="${small}" alt="pct" width="50%" style="width: 50%; height: auto;"></p>`,
    `<div data-type="floating-text-box" data-x="40" data-y="900" data-width="360"><div data-floating-box-content><p>Box</p><p><img class="editor-image" src="${small}" alt="box-unsized"></p><p><img class="editor-image" src="${small}" alt="box-pct" width="75%" style="width: 75%; height: auto;"></p></div></div>`,
  ].join("");
  await request.put("/api/page", { data: { path: saved.path, title, content: body } });
  await page.goto(`/?page=${encodeURIComponent(saved.path)}`);
  await expect(page.getByTestId("rich-text-editor")).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => Array.from(document.querySelectorAll<HTMLImageElement>(".ProseMirror img[alt]"))
    .filter((img) => img.alt).every((img) => img.complete && img.naturalWidth > 0 && img.getBoundingClientRect().width > 0)), { timeout: 30_000 }).toBe(true);
  const sample = () => page.evaluate(() => {
    const out: Record<string, number> = {};
    document.querySelectorAll<HTMLImageElement>(".ProseMirror img").forEach((img) => { out[img.alt] = Math.round(img.getBoundingClientRect().width); });
    const frame = document.querySelector("[data-testid=editor-main-flow-outline]") as HTMLElement | null;
    out.frame = Math.round(frame?.getBoundingClientRect().width ?? -1);
    const box = document.querySelector("[data-type=floating-text-box]") as HTMLElement | null;
    out.box = Math.round(box?.getBoundingClientRect().width ?? -1);
    return out;
  });
  const samples = [];
  for (let i = 0; i < 6; i += 1) {
    samples.push(await sample());
    await page.waitForTimeout(1000);
  }
  console.log(testInfo.project.name, JSON.stringify(samples, null, 0));
  // Click into the editor body to exercise focus/selection paths.
  await page.locator(".ProseMirror p").first().click();
  for (let i = 0; i < 3; i += 1) { await page.waitForTimeout(1000); samples.push(await sample()); }
  console.log(testInfo.project.name, "after click", JSON.stringify(samples.slice(-3)));
  const first = samples[1];
  const last = samples[samples.length - 1];
  expect(last).toEqual(first);
  expect(last["u-big"]).toBeLessThanOrEqual(last.frame);
  expect(last.frame).toBeLessThan(800);
  expect(last.px).toBe(240);
  await request.delete(`/api/page?path=${encodeURIComponent(saved.path)}`).catch(() => undefined);
});
