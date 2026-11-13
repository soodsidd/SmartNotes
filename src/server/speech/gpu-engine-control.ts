/**
 * Start/stop the optional GPU speech engine so the dictation GPU setting can
 * free VRAM. The engine runs from a Windows scheduled task (logon trigger)
 * whose launcher restarts the engine if it exits, so stopping means:
 * disable the task (no restart at next logon), end it (stops the launcher
 * loop), then kill the engine process. Starting reverses that.
 */

import { execFile } from "node:child_process";
import net from "node:net";

export const DEFAULT_GPU_ENGINE_TASK = "SmartNotes GPU Speech Engine";
export const DEFAULT_GPU_ENGINE_PROCESS = "sherpa-onnx-offline-websocket-server.exe";

export type GpuEngineState = "running" | "stopped";

export type CommandRunner = (file: string, args: string[]) => Promise<void>;

const defaultRunner: CommandRunner = (file, args) =>
  new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true, timeout: 15_000 }, (error, _stdout, stderr) => {
      if (error) reject(new Error(String(stderr || error.message).trim()));
      else resolve();
    });
  });

function taskName() {
  return process.env.SMART_NOTES_SPEECH_GPU_TASK?.trim() || DEFAULT_GPU_ENGINE_TASK;
}

function processName() {
  return process.env.SMART_NOTES_SPEECH_GPU_PROCESS?.trim() || DEFAULT_GPU_ENGINE_PROCESS;
}

export async function stopGpuEngine(run: CommandRunner = defaultRunner): Promise<void> {
  if (process.platform !== "win32") throw new Error("GPU engine control is only supported on Windows.");
  const task = taskName();
  await run("schtasks", ["/Change", "/TN", task, "/DISABLE"]);
  // /End fails when the task is not running; that is fine.
  await run("schtasks", ["/End", "/TN", task]).catch(() => undefined);
  // taskkill fails when no engine process exists; that is fine too.
  await run("taskkill", ["/F", "/IM", processName()]).catch(() => undefined);
}

export async function startGpuEngine(run: CommandRunner = defaultRunner): Promise<void> {
  if (process.platform !== "win32") throw new Error("GPU engine control is only supported on Windows.");
  const task = taskName();
  await run("schtasks", ["/Change", "/TN", task, "/ENABLE"]);
  await run("schtasks", ["/Run", "/TN", task]);
}

/** Is something accepting connections at the GPU engine's host:port? */
export function probeGpuEngine(url: string, timeoutMs = 750): Promise<GpuEngineState> {
  let host = "127.0.0.1";
  let port = 0;
  try {
    const parsed = new URL(url);
    host = parsed.hostname || host;
    port = Number(parsed.port) || (parsed.protocol === "wss:" ? 443 : 80);
  } catch {
    return Promise.resolve("stopped");
  }
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (state: GpuEngineState) => {
      socket.destroy();
      resolve(state);
    };
    socket.setTimeout(timeoutMs, () => done("stopped"));
    socket.once("connect", () => done("running"));
    socket.once("error", () => done("stopped"));
  });
}
