import { expect, test, type Page } from "@playwright/test";

/**
 * SN-285: while a Companion reply streams, scrolling up holds the viewport;
 * Jump to latest snaps back and rejoins following. Drives the real AiSidebar
 * via the dev showcase stream mode (`/dev-screens?stream=1`).
 */

async function appendToken(page: Page, text: string) {
  await page.evaluate((token) => {
    const stream = (window as unknown as { __devScreensStream?: { append: (text: string) => void } })
      .__devScreensStream;
    if (!stream) throw new Error("__devScreensStream not available");
    stream.append(token);
  }, text);
  await page.waitForTimeout(30);
}

const paragraph = (index: number) =>
  `Paragraph ${index}: progressive overload means adding a little load or volume each week while keeping form clean.\n\n`;

const metrics = (page: Page) =>
  page.getByTestId("ai-transcript").evaluate((node) => ({
    scrollTop: Math.round(node.scrollTop),
    gap: Math.round(node.scrollHeight - node.clientHeight - node.scrollTop),
  }));

for (const surface of ["desktop", "mobile"] as const) {
  test(`SN-285 streaming keeps reading position and Jump to latest rejoins (${surface})`, async ({ page, isMobile }) => {
    test.skip(isMobile !== (surface === "mobile"), `${surface} project only`);
    if (surface === "desktop") {
      await page.setViewportSize({ width: 1440, height: 900 });
    }
    await page.addInitScript(() => window.localStorage.setItem("theme", "light"));
    await page.goto(`/dev-screens?surface=${surface}&stream=1`);
    if (surface === "desktop") {
      // The showcase rail grows with the page; bound it like the shell's viewport-height rail.
      await page.addStyleTag({ content: '[data-testid="ai-sidebar-rail"] { height: calc(100vh - 4rem); }' });
    }
    const transcript = page.getByTestId("ai-transcript");
    await expect(transcript).toContainText("Summarize the minimum versions");
    await page.waitForFunction(() => Boolean((window as unknown as { __devScreensStream?: unknown }).__devScreensStream));

    // Stream enough content to overflow; transcript auto-follows at the bottom.
    for (let index = 1; index <= 30; index += 1) {
      await appendToken(page, paragraph(index));
    }
    expect((await metrics(page)).gap).toBeLessThanOrEqual(1);
    await expect(page.getByTestId("ai-jump-to-latest")).toHaveCount(0);

    // Reader scrolls up to an earlier part of the answer.
    if (surface === "desktop") {
      await transcript.hover();
      await page.mouse.wheel(0, -700);
    } else {
      await transcript.evaluate((node) => node.scrollBy(0, -700));
    }
    await expect(page.getByTestId("ai-jump-to-latest")).toBeVisible();
    const parked = (await metrics(page)).scrollTop;

    for (let index = 31; index <= 40; index += 1) {
      await appendToken(page, paragraph(index));
    }
    const afterStream = await metrics(page);
    expect(afterStream.scrollTop).toBe(parked);
    expect(afterStream.gap).toBeGreaterThan(48);
    await page.screenshot({ path: `e2e/evidence/sn-285-${surface}-preserved-jump.png` });

    await page.getByTestId("ai-jump-to-latest").click();
    expect((await metrics(page)).gap).toBeLessThanOrEqual(1);
    await expect(page.getByTestId("ai-jump-to-latest")).toHaveCount(0);

    // Following resumes for subsequent tokens.
    for (let index = 41; index <= 44; index += 1) {
      await appendToken(page, paragraph(index));
    }
    expect((await metrics(page)).gap).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `e2e/evidence/sn-285-${surface}-following.png` });
  });
}
