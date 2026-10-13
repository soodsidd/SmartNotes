/** SN-301: the launcher must outlive its app child and refuse port conflicts. */
import { spawn, type ChildProcess } from "child_process";
import fs from "fs";
import http from "http";
import net from "net";
import os from "os";
import path from "path";

const supervisorSource = path.resolve(__dirname, "../gateway-start.js");

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function poll<T>(read: () => Promise<T>, ready: (value: T) => boolean): Promise<T> {
  for (let i = 0; i < 60; i++) {
    try {
      const value = await read();
      if (ready(value)) return value;
    } catch { /* launcher may still be starting */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for supervisor state");
}

describe("Smart Notes lifecycle supervisor", () => {
  let directory: string;
  let supervisor: ChildProcess;
  let appPort: number;
  let controlPort: number;
  let origin: string;

  const status = async () => {
    const response = await fetch(`http://localhost:${controlPort}/status`, { headers: { Origin: origin } });
    return response.json();
  };
  const action = async (name: string) => {
    const response = await fetch(`http://localhost:${controlPort}/${name}`, { method: "POST", headers: { Origin: origin } });
    return { code: response.status, body: await response.json() };
  };

  beforeAll(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "sn301-supervisor-"));
    fs.mkdirSync(path.join(directory, ".next"));
    fs.writeFileSync(path.join(directory, ".next", "BUILD_ID"), "test-build");
    fs.copyFileSync(supervisorSource, path.join(directory, "gateway-start.js"));
    fs.writeFileSync(path.join(directory, "serve-prebuilt.js"), `
      const http = require('http');
      http.createServer((req, res) => res.end('ok')).listen(Number(process.env.PORT), '127.0.0.1', () => console.log('fake server ready'));
    `);
    appPort = await freePort();
    controlPort = await freePort();
    origin = `http://localhost:${appPort}`;
    supervisor = spawn(process.execPath, [path.join(directory, "gateway-start.js")], {
      cwd: directory,
      env: { ...process.env, PORT: String(appPort), SMART_NOTES_CONTROL_PORT: String(controlPort) },
      stdio: "ignore",
      windowsHide: true,
    });
    await poll(status, (value) => value.status === "running");
  });

  afterAll(async () => {
    // Windows SIGTERM is TerminateProcess, so stop the app child first.
    await action("stop").catch(() => undefined);
    if (supervisor?.exitCode === null) {
      await new Promise<void>((resolve) => {
        supervisor.once("exit", () => resolve());
        supervisor.kill("SIGTERM");
      });
    }
    if (directory) fs.rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it("keeps control available across stop, start, and restart", async () => {
    const first = await status();
    expect(first).toMatchObject({ status: "running", reachable: true, build: "test-build" });
    expect(first.pid).toEqual(expect.any(Number));
    expect((await action("stop")).body.status).toBe("stopped");
    expect((await status()).pid).toBeNull();
    const started = await action("start");
    expect(started.body.status).toBe("running");
    expect(started.body.pid).not.toBe(first.pid);
    const restarted = await action("restart");
    expect(restarted.body.status).toBe("running");
    expect(restarted.body.pid).not.toBe(started.body.pid);
    expect(restarted.body.log).toContain("fake server ready");
  });

  it("rejects cross-origin control requests", async () => {
    const response = await fetch(`http://localhost:${controlPort}/stop`, { method: "POST", headers: { Origin: "http://evil.example" } });
    expect(response.status).toBe(403);
    expect((await status()).status).toBe("running");
  });

  it("rejects DNS-rebinding origins that match the app port", async () => {
    const rebound = await new Promise<number>((resolve) => {
      const req = http.request({
        host: "127.0.0.1",
        port: controlPort,
        path: "/stop",
        method: "POST",
        headers: { Origin: `http://attacker.example:${appPort}`, Host: `attacker.example:${controlPort}` },
      }, (res) => { res.resume(); resolve(res.statusCode ?? 0); });
      req.end();
    });
    expect(rebound).toBe(403);
    expect((await status()).status).toBe("running");
  });

  it("refuses to start a second server while the app port is taken", async () => {
    expect((await action("stop")).body.status).toBe("stopped");
    const squatter = net.createServer().listen(appPort, "127.0.0.1");
    await new Promise((resolve) => squatter.once("listening", resolve));
    try {
      const refused = await action("start");
      expect(refused.code).toBe(409);
      expect(refused.body.error).toMatch(/already in use/);
      expect(refused.body.status).toBe("stopped");
    } finally {
      await new Promise((resolve) => squatter.close(resolve));
    }
    expect((await action("start")).body.status).toBe("running");
  });

  it("lets a newer launcher take over the control port from a stale supervisor", async () => {
    const stale = supervisor;
    const stalePid = (await status()).pid;
    const staleExit = new Promise<number | null>((resolve) => stale.once("exit", (code) => resolve(code)));
    supervisor = spawn(process.execPath, [path.join(directory, "gateway-start.js")], {
      cwd: directory,
      env: { ...process.env, PORT: String(appPort), SMART_NOTES_CONTROL_PORT: String(controlPort) },
      stdio: "ignore",
      windowsHide: true,
    });
    expect(await staleExit).toBe(0);
    const replaced = await poll(status, (value) => value.status === "running" && value.pid !== stalePid);
    expect(replaced.log).toContain("supervisor replaced by a newer launcher");
  }, 30000);
});
