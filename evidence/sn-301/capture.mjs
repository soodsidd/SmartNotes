// Live evidence for fork photo #1 against a worktree-local gateway-start.js supervisor.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const base = process.env.SN301_PREVIEW_URL;
if (!base) throw new Error("Set SN301_PREVIEW_URL to the supervised worktree preview URL.");
const output = path.dirname(fileURLToPath(import.meta.url));
const checks = [];
const check = (ok, label) => checks.push(`${ok ? "PASS" : "FAIL"} ${label}`);
const reachable = () => fetch(new URL("/api/version", base), { cache: "no-store" }).then((r) => r.ok, () => false);
const browser = await chromium.launch({ headless: true });

async function openServerTab(viewport) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  const errors = [];
  let serverDown = false;
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !serverDown) errors.push(`console: ${message.text()}`);
  });
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.getByTestId("shell-more-menu").waitFor({ state: "visible", timeout: 60000 });
  const trigger = page.getByTestId("app-settings-trigger");
  const dialog = page.getByTestId("app-settings-dialog");
  const serverTab = dialog.getByTestId("settings-tab-server");
  const panel = dialog.getByTestId("server-settings-panel");
  // The SSR More button is visible before hydration attaches its handler, and a
  // freshly opened dialog can still close on the menu's trailing pointer events,
  // so step More → Settings → Server until the panel is actually showing.
  for (let attempt = 0; attempt < 30 && !(await panel.isVisible()); attempt++) {
    if (await serverTab.isVisible()) await serverTab.click({ timeout: 1500 }).catch(() => undefined);
    else if (await trigger.isVisible()) await trigger.click({ timeout: 1500 }).catch(() => undefined);
    else await page.getByTestId("shell-more-menu").click({ timeout: 1500 }).catch(() => undefined);
    await page.waitForTimeout(700);
  }
  await dialog.getByTestId("server-stop").waitFor({ state: "visible" });
  await page.waitForFunction(() => !document.querySelector('[data-testid="server-stop"]')?.hasAttribute("disabled"), null, { timeout: 30000 });
  return { page, dialog, errors, setServerDown: (value) => { serverDown = value; } };
}

const pid = async (dialog) => (await dialog.locator("dt:text-is('Process') + dd").innerText()).trim();

const desktop = await openServerTab({ width: 1440, height: 900 });
const { dialog } = desktop;
const tabs = (await dialog.locator('[data-testid^="settings-tab-"]').allInnerTexts()).map((label) => label.trim());
check(tabs.join(",") === "General,Notebooks,Backups,Ingest,Server", `tab order ${tabs.join(" · ")}`);
check((await dialog.innerText()).includes("Status and start/stop controls for the local Smart Notes server."), "dialog subtitle matches spec §1");
check(await dialog.getByTestId("server-status-pill").innerText() === "Running", "pill reads Running");
const rows = (await dialog.locator("dt").allInnerTexts()).map((label) => label.trim());
check(rows.join(",") === "Address,Reachable,Process,Uptime,Build", `rows ${rows.join(" · ")}`);
const version = await fetch(new URL("/api/version", base)).then((r) => r.json());
const build = (await dialog.locator("dt:text-is('Build') + dd").innerText()).trim();
check(build === version.buildId, `Build row ${build} matches /api/version`);
check(await dialog.getByTestId("server-start").isDisabled(), "Start is disabled while running");
await dialog.getByTestId("server-log-toggle").evaluate((node) => node.blur());
await desktop.page.waitForTimeout(3500);
await dialog.screenshot({ path: path.join(output, "01-server-tab-desktop.png") });
await desktop.page.screenshot({ path: path.join(output, "01-server-tab-desktop-full.png") });

const firstPid = await pid(dialog);
desktop.setServerDown(true);
await dialog.getByTestId("server-stop").click();
await dialog.getByTestId("server-status-pill").filter({ hasText: "Stopped" }).waitFor({ timeout: 20000 });
check(!(await reachable()), "app port closed after Stop");
check(await dialog.locator("dt:text-is('Reachable') + dd").innerText() === "No", "Reachable reads No while stopped");
await dialog.getByTestId("server-start").waitFor({ state: "visible" });
await desktop.page.waitForFunction(() => !document.querySelector('[data-testid="server-start"]')?.hasAttribute("disabled"));
check(true, "Start is enabled while the app server is stopped");
await dialog.screenshot({ path: path.join(output, "02-server-stopped-desktop.png") });

await dialog.getByTestId("server-start").click();
await dialog.getByTestId("server-status-pill").filter({ hasText: "Running" }).waitFor({ timeout: 60000 });
desktop.setServerDown(false);
const startedPid = await pid(dialog);
check(await reachable(), "app port answers after Start");
check(startedPid !== firstPid && /^\d+$/.test(startedPid), `Start launched a new process (${firstPid} → ${startedPid})`);

await dialog.getByTestId("server-restart").click();
await desktop.page.waitForFunction((previous) => {
  const value = [...document.querySelectorAll("dt")].find((node) => node.textContent === "Process")?.nextElementSibling?.textContent;
  return value && value !== previous && /^\d+$/.test(value);
}, startedPid, { timeout: 60000 });
await dialog.getByTestId("server-status-pill").filter({ hasText: "Running" }).waitFor({ timeout: 60000 });
const restartedPid = await pid(dialog);
check(restartedPid !== startedPid, `Restart replaced the process (${startedPid} → ${restartedPid})`);

await dialog.getByTestId("server-log-toggle").click();
const log = await dialog.getByTestId("server-log").innerText();
check(/server exited/.test(log) && log.includes("Smart Notes — http://"), "Recent server log shows the supervisor tail (exit + startup banner lines)");
await dialog.getByTestId("server-log").evaluate((node) => { node.scrollTop = node.scrollHeight; });
await dialog.screenshot({ path: path.join(output, "03-server-log-desktop.png") });
check(desktop.errors.length === 0, `zero page/console errors while the server was up (${desktop.errors.length})`);

await desktop.page.close();
const mobile = await openServerTab({ width: 430, height: 932 });
const overflow = await mobile.page.evaluate(() => {
  const panel = document.querySelector('[data-testid="server-settings-panel"]');
  return panel ? panel.scrollWidth - panel.clientWidth : -1;
});
check(overflow === 0, `mobile panel has no horizontal overflow (${overflow}px)`);
await mobile.page.screenshot({ path: path.join(output, "04-server-tab-mobile.png") });
check(mobile.errors.length === 0, `zero mobile page/console errors (${mobile.errors.length})`);

const errors = [...desktop.errors, ...mobile.errors];
await fs.writeFile(path.join(output, "console.txt"), [...checks, "", "Console errors (server-up windows):", ...(errors.length ? errors : ["(none)"])].join("\n") + "\n");
console.log(checks.join("\n"));
await browser.close();
process.exit(checks.some((line) => line.startsWith("FAIL")) ? 1 : 0);
