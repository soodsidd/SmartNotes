import { expect, test } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

const vault = path.resolve(__dirname, "..", ".e2e-vault");
const stamp = Date.now();
const target = `SN382 Target ${stamp}`;
const unrelated = `SN382 Unrelated ${stamp}`;

test("reopening a closed notebook fetches only its tree and makes its pages navigable", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop notebook picker workflow");
  const previous = await page.request.get("/api/ui-state").then((response) => response.json());
  try {
    for (const name of [target, unrelated]) {
      const section = path.join(vault, name, "Notes");
      await fs.mkdir(section, { recursive: true });
      await fs.writeFile(path.join(section, "Page.html"), `---\ntitle: ${name} page\n---\n<p>${name} body</p>`, "utf8");
    }
    await page.request.patch("/api/ui-state", {
      data: { closedNotebooks: [...(previous.state?.closedNotebooks ?? []), target, unrelated] },
    });

    await page.goto("/");
    await expect(page.getByTestId("app-shell")).toBeVisible();
    await page.getByTestId("open-closed-notebook-btn").first().click();
    const pickerRow = page.getByTestId(`picker-notebook-${target}`);
    await expect(pickerRow).toContainText("Closed");

    const responsePromise = page.waitForResponse((response) =>
      response.url().includes(`/api/vault?`) &&
      new URL(response.url()).searchParams.get("notebook") === target &&
      response.status() === 200
    );
    await pickerRow.getByRole("button", { name: target, exact: false }).first().click();
    const payload = await (await responsePromise).json();
    expect(payload.tree.map((notebook: { path: string }) => notebook.path)).toEqual([target]);
    expect(payload.tree[0].sections[0].pages[0].title).toBe(`${target} page`);

    await expect(page.getByTestId(`page-${target}/Notes/Page.html`).first()).toBeVisible();
    await page.getByTestId(`page-${target}/Notes/Page.html`).first().click();
    await expect(page.getByTestId(`page-${target}/Notes/Page.html`).first()).toHaveAttribute("data-selected", "true");
    await page.getByTestId("open-closed-notebook-btn").first().click();
    await expect(page.getByTestId(`picker-notebook-${unrelated}`)).toContainText("Closed");
  } finally {
    await page.request.patch("/api/ui-state", { data: { closedNotebooks: previous.state?.closedNotebooks ?? [] } });
    await Promise.all([target, unrelated].map((name) => fs.rm(path.join(vault, name), { recursive: true, force: true })));
  }
});
