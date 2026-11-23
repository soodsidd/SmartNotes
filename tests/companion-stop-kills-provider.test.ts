/** @jest-environment node */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const { killProcessTree } = require("../packages/cli-chat/index");

function isAlive(pid: number) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function waitFor<T>(read: () => T | undefined, timeoutMs: number): Promise<T> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("timed out");
}

describe("companion Stop", () => {
  it("kills the provider launched behind a shell shim, not just the shell", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sn-stop-tree-"));
    const pidFile = path.join(dir, "provider.pid");
    const stub = path.join(dir, "provider.js");
    fs.writeFileSync(stub, `require("fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000);`);
    // Same launch shape as the Codex provider on Windows: shell: true.
    const proc = spawn(`node "${stub}"`, { shell: true, windowsHide: true, stdio: "ignore" });
    let providerPid = 0;
    try {
      providerPid = Number(await waitFor(() => (fs.existsSync(pidFile) ? fs.readFileSync(pidFile, "utf8").trim() : undefined), 10_000));
      expect(isAlive(providerPid)).toBe(true);

      killProcessTree(proc);

      await waitFor(() => (isAlive(providerPid) ? undefined : true), 5_000);
      expect(isAlive(providerPid)).toBe(false);
    } finally {
      if (providerPid && isAlive(providerPid)) process.kill(providerPid);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 20_000);
});
