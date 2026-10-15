import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { ensureNotebookTreeVisible } from "./helpers";

const EVIDENCE = path.resolve(__dirname, "evidence", "SN-310");
const BODY = `<!doctype html><html><head><style>
  body { font-family: Georgia, serif; margin: 0; padding: 32px; color: #1f2933; }
  .resume h1 { font-size: 32px; margin: 0 0 4px; }
  .resume .role { color: #52606d; margin: 0 0 20px; }
  .resume h2 { font-size: 15px; letter-spacing: .08em; text-transform: uppercase; border-bottom: 1px solid #cbd2d9; padding-bottom: 4px; }
</style></head><body><main class="resume">
  <h1>Jane Doe</h1>
  <p class="role">Senior Product Designer</p>
  <h2>Experience</h2>
  <p>Led the redesign of a portfolio site used by 40k designers.</p>
</main></body></html>`;

async function createDesign(request: APIRequestContext, title: string) {
  const created = await request.post("/api/agent/vault", {
    data: { tool: "page_create", args: { sectionPath: "Personal Notebook/Quick Notes", title, noteType: "design" } },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const pagePath = (await created.json()).result.data.page.path as string;
  const written = await request.post("/api/agent/vault", { data: { tool: "page_write", args: { path: pagePath, body: BODY } } });
  expect(written.ok(), await written.text()).toBeTruthy();
  return pagePath;
}

async function openDesign(page: Page, title: string) {
  await page.goto("/");
  await expect(page.getByTestId("app-shell")).toBeVisible();
  const tree = await ensureNotebookTreeVisible(page);
  await tree.getByText(title, { exact: true }).first().click();
  const frame = page.frameLocator('[data-testid="design-page-frame"]');
  await expect(frame.locator(".resume h1")).toHaveText("Jane Doe", { timeout: 60_000 });
  return frame;
}

test("SN-310: owner adds a companion comment on a design page Preview and it persists", async ({ page, request }, testInfo) => {
  test.setTimeout(180_000);
  const mobile = testInfo.project.name === "mobile";
  const title = `sn310-design-${testInfo.project.name}-${Date.now()}`;
  const pagePath = await createDesign(request, title);
  const frame = await openDesign(page, title);
  await fs.mkdir(EVIDENCE, { recursive: true });

  const heading = frame.locator(".resume h1");
  if (mobile) {
    // Long-press: the frame bridge opens the menu after a 600ms touch hold.
    const box = await heading.boundingBox();
    const frameBox = await page.getByTestId("design-page-frame").boundingBox();
    expect(box && frameBox).toBeTruthy();
    const init = { pointerType: "touch", isPrimary: true, bubbles: true, clientX: box!.x - frameBox!.x + 20, clientY: box!.y - frameBox!.y + 10 };
    await heading.dispatchEvent("pointerdown", init);
    await page.waitForTimeout(800);
  } else {
    await heading.click({ button: "right" });
  }

  const addComment = page.getByRole("menuitem", { name: /Add comment/ });
  await expect(addComment).toBeVisible();
  await expect(page.getByRole("menuitem", { name: /Ask Companion/ })).toBeVisible();
  await page.screenshot({ path: path.join(EVIDENCE, `${testInfo.project.name}-add-comment-menu.png`) });

  await addComment.click();
  await page.getByTestId("comment-composer-textarea").fill("Make the name larger and use the accent color.");
  await page.screenshot({ path: path.join(EVIDENCE, `${testInfo.project.name}-composer.png`) });
  await page.getByTestId("comment-composer-submit").click();

  const panel = page.getByTestId("design-comments-panel");
  await expect(panel.getByText("Make the name larger and use the accent color.")).toBeVisible();
  await expect(page.getByTestId("design-comment-pin")).toHaveText("1");

  // Persisted through the shared comments API with a design-element anchor.
  await expect.poll(async () => {
    const response = await request.get(`/api/page/comments?path=${encodeURIComponent(pagePath)}`);
    return (await response.json()).comments as Array<{ quote: string; target?: { tag: string } }>;
  }, { timeout: 30_000 }).toEqual([
    expect.objectContaining({ quote: "Jane Doe", text: "Make the name larger and use the accent color.", target: expect.objectContaining({ kind: "design-element", tag: "h1" }) }),
  ]);
  await page.screenshot({ path: path.join(EVIDENCE, `${testInfo.project.name}-comment-saved.png`) });

  // Companion page_get sees it exactly like a text-page comment.
  const got = await request.post("/api/agent/vault", { data: { tool: "page_get", args: { path: pagePath } } });
  expect(got.ok(), await got.text()).toBeTruthy();
  const gotComments = (await got.json()).result.data.comments as Array<{ text: string }>;
  expect(gotComments.map((comment) => comment.text)).toEqual(["Make the name larger and use the accent color."]);

  // Survives reload; the pin is re-placed from the frame and the design is unchanged.
  await page.reload();
  const reloaded = page.frameLocator('[data-testid="design-page-frame"]');
  await expect(reloaded.locator(".resume h1")).toHaveText("Jane Doe", { timeout: 60_000 });
  await expect(page.getByTestId("design-comment-pin")).toHaveText("1", { timeout: 30_000 });
  await page.getByTestId("design-comments-toggle").click();
  await page.getByTestId("design-comment-resolve").click();
  await expect.poll(async () => {
    const response = await request.get(`/api/page/comments?path=${encodeURIComponent(pagePath)}`);
    return ((await response.json()).comments as Array<{ resolvedAt: string | null }>)[0]?.resolvedAt ?? null;
  }, { timeout: 30_000 }).not.toBeNull();
  await expect(page.getByTestId("design-comment-pin")).toHaveCount(0);

  const stored = (await (await request.get(`/api/page?path=${encodeURIComponent(pagePath)}`)).json()).page;
  expect(stored.metadata.note_type).toBe("design");
  expect(stored.body).toContain("<h1>Jane Doe</h1>");
});
