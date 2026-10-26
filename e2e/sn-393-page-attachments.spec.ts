import { expect, test } from "@playwright/test";
import { apiCreatePage } from "./helpers";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

test("SN-393: arbitrary page attachments survive reload beside image and PDF", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop attachment picker");
  const title = `sn393-${Date.now()}`;
  const created = await apiCreatePage(request, {
    notebookPath: "Personal Notebook",
    sectionPath: "Personal Notebook/Quick Notes",
    title,
  });

  await page.goto("/");
  await expect(page.getByTestId("app-shell")).toBeVisible();
  await page.getByTestId("tree").getByText(title, { exact: true }).first().click();
  const editor = page.locator(".ProseMirror.editor-content");
  await expect(editor).toBeVisible();
  const attachmentInput = page.getByTestId("attachment-file-input");
  await expect(attachmentInput).not.toHaveAttribute("accept", /pdf|image/);

  const zipBytes = Buffer.from("SN-393 archive fixture");
  await attachmentInput.setInputFiles({ name: "research.zip", mimeType: "application/zip", buffer: zipBytes });
  const chip = editor.locator('[data-file-type="file"]');
  await expect(chip).toContainText("research.zip");
  await expect(chip).toContainText("ZIP · 22 B");
  const open = chip.locator(".file-attachment-name");
  const download = chip.locator(".file-attachment-download");
  const href = await open.getAttribute("href");
  expect(href).toMatch(/^\/vault\/.*\.assets\/research\.zip$/);
  await expect(download).toHaveAttribute("href", href!);
  await expect(download).toHaveAttribute("download", "research.zip");
  const stored = await request.get(href!);
  expect(stored.status()).toBe(200);
  expect(await stored.body()).toEqual(zipBytes);

  await attachmentInput.setInputFiles({ name: "picture.png", mimeType: "image/png", buffer: PNG });
  await expect(editor.locator('img[src*=".assets/picture.png"]')).toHaveCount(1);
  await attachmentInput.setInputFiles({ name: "paper.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%%EOF") });
  await expect(editor.locator('[data-file-type="pdf"]')).toContainText("paper.pdf");

  await expect.poll(async () => {
    const response = await request.get(`/api/page?path=${encodeURIComponent(created.path)}`);
    const { page: saved } = (await response.json()) as { page: { body: string } };
    return ["research.zip", "picture.png", "paper.pdf"].every((name) => saved.body.includes(name));
  }, { timeout: 20000 }).toBe(true);
  await expect(page.getByTestId("save-status")).toContainText("Saved", { timeout: 20000 });
  await page.reload();
  await expect(editor.locator('[data-file-type="file"]')).toContainText("research.zip");
  await expect(editor.locator('[data-file-type="file"]')).toContainText("ZIP · 22 B");
  await expect(editor.locator('[data-file-type="file"] .file-attachment-download')).toHaveAttribute("href", href!);
  await expect(editor.locator('img[src*=".assets/picture.png"]')).toHaveCount(1);
  await expect(editor.locator('[data-file-type="pdf"]')).toContainText("paper.pdf");
});
