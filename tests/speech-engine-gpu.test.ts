/**
 * Dictation GPU acceleration: PC-wide setting, GPU-first engine routing with
 * CPU fallback, GPU engine start/stop commands, and the /api/speech/engine route.
 */

import { promises as fs } from "node:fs";
import { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { WebSocketServer, type WebSocket as WsSocket } from "ws";

jest.mock("@/server/speech/gpu-engine-control", () => {
  const actual = jest.requireActual("@/server/speech/gpu-engine-control");
  return { ...actual, startGpuEngine: jest.fn(async () => undefined), stopGpuEngine: jest.fn(async () => undefined) };
});

import { DICTATION_SAMPLE_RATE } from "@/lib/speech/pcm";
import { SpeechEngineError, transcribeClip } from "@/server/speech/engine-client";
import {
  readSpeechEngineSettings,
  resolveSpeechEngineTargets,
  writeSpeechEngineSettings,
} from "@/server/speech/engine-settings";
import * as control from "@/server/speech/gpu-engine-control";

const actualControl = jest.requireActual("@/server/speech/gpu-engine-control") as typeof control;

interface Fake {
  url: string;
  hits: number;
  close: () => Promise<void>;
}

function startFake(label: string, reply = true): Promise<Fake> {
  return new Promise((resolve) => {
    const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    const fake: Fake = { url: "", hits: 0, close: async () => undefined };
    server.on("connection", (socket: WsSocket) => {
      let buffer = Buffer.alloc(0);
      socket.on("message", (data: Buffer, isBinary: boolean) => {
        if (!isBinary) return socket.close();
        buffer = Buffer.concat([buffer, data]);
        if (buffer.byteLength < 8 || buffer.byteLength < 8 + buffer.readInt32LE(4)) return;
        fake.hits += 1;
        if (reply) socket.send(JSON.stringify({ text: `${label}${fake.hits}` }));
      });
    });
    server.on("listening", () => {
      fake.url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
      fake.close = () =>
        new Promise<void>((done) => {
          server.clients.forEach((client) => client.terminate());
          server.close(() => done());
        });
      resolve(fake);
    });
  });
}

async function closedUrl() {
  const fake = await startFake("x");
  await fake.close();
  return fake.url;
}

const clip = (seconds: number) => new Float32Array(Math.round(seconds * DICTATION_SAMPLE_RATE)).fill(0.1);

let stateDir: string;
const savedEnv = { ...process.env };

beforeEach(async () => {
  stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "sn-speech-gpu-"));
  process.env.SMART_NOTES_STATE_DIR = stateDir;
  process.env.SMART_NOTES_SPEECH_ENGINE_URL = "ws://127.0.0.1:6006";
  process.env.SMART_NOTES_SPEECH_GPU_ENGINE_URL = "ws://127.0.0.1:6007";
  jest.clearAllMocks();
});

afterEach(async () => {
  process.env = { ...savedEnv };
  await fs.rm(stateDir, { recursive: true, force: true });
});

describe("speech engine settings", () => {
  it("defaults to GPU on, persists changes, and routes GPU first only when enabled", async () => {
    expect(await readSpeechEngineSettings()).toEqual({ gpuAcceleration: true });
    expect(await resolveSpeechEngineTargets()).toEqual(["ws://127.0.0.1:6007", "ws://127.0.0.1:6006"]);

    await writeSpeechEngineSettings({ gpuAcceleration: false });
    expect(await readSpeechEngineSettings()).toEqual({ gpuAcceleration: false });
    expect(await resolveSpeechEngineTargets()).toEqual(["ws://127.0.0.1:6006"]);
  });

  it("uses only the CPU engine when no GPU engine is configured", async () => {
    delete process.env.SMART_NOTES_SPEECH_GPU_ENGINE_URL;
    expect(await resolveSpeechEngineTargets()).toEqual(["ws://127.0.0.1:6006"]);
  });
});

describe("transcribeClip engine fallback", () => {
  it("uses the GPU engine when it is up", async () => {
    const gpu = await startFake("gpu");
    const cpu = await startFake("cpu");
    try {
      const result = await transcribeClip(clip(2), DICTATION_SAMPLE_RATE, { urls: [gpu.url, cpu.url] });
      expect(result.text).toBe("gpu1");
      expect(cpu.hits).toBe(0);
    } finally {
      await gpu.close();
      await cpu.close();
    }
  });

  it("falls back to the CPU engine for the whole clip when the GPU engine is offline", async () => {
    const cpu = await startFake("cpu");
    try {
      const result = await transcribeClip(clip(65), DICTATION_SAMPLE_RATE, { urls: [await closedUrl(), cpu.url] });
      expect(result.chunks).toBe(3);
      expect(result.text).toBe("cpu1 cpu2 cpu3");
    } finally {
      await cpu.close();
    }
  });

  it("does not fall back when a live GPU engine times out", async () => {
    const gpu = await startFake("gpu", false);
    const cpu = await startFake("cpu");
    try {
      await expect(
        transcribeClip(clip(2), DICTATION_SAMPLE_RATE, { urls: [gpu.url, cpu.url], responseTimeoutMs: 200 })
      ).rejects.toMatchObject({ code: "engine_timeout" });
      expect(cpu.hits).toBe(0);
    } finally {
      await gpu.close();
      await cpu.close();
    }
  });

  it("reports offline when every engine is offline", async () => {
    await expect(
      transcribeClip(clip(2), DICTATION_SAMPLE_RATE, { urls: [await closedUrl(), await closedUrl()] })
    ).rejects.toBeInstanceOf(SpeechEngineError);
  });
});

describe("GPU engine control", () => {
  const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
  beforeEach(() => Object.defineProperty(process, "platform", { value: "win32" }));
  afterEach(() => Object.defineProperty(process, "platform", platform));

  it("stop disables the task, ends it, then kills the engine (tolerating not-running errors)", async () => {
    const calls: string[] = [];
    const run = jest.fn(async (file: string, args: string[]) => {
      calls.push([file, ...args].join(" "));
      if (file !== "schtasks" || args[0] !== "/Change") throw new Error("not running");
    });
    await actualControl.stopGpuEngine(run);
    expect(calls).toEqual([
      "schtasks /Change /TN SmartNotes GPU Speech Engine /DISABLE",
      "schtasks /End /TN SmartNotes GPU Speech Engine",
      "taskkill /F /IM sherpa-onnx-offline-websocket-server.exe",
    ]);
  });

  it("start re-enables and runs the task", async () => {
    const calls: string[] = [];
    await actualControl.startGpuEngine(async (file, args) => {
      calls.push([file, ...args].join(" "));
    });
    expect(calls).toEqual([
      "schtasks /Change /TN SmartNotes GPU Speech Engine /ENABLE",
      "schtasks /Run /TN SmartNotes GPU Speech Engine",
    ]);
  });

  it("probe reports running only when the port accepts connections", async () => {
    const fake = await startFake("p");
    try {
      expect(await actualControl.probeGpuEngine(fake.url)).toBe("running");
    } finally {
      await fake.close();
    }
    expect(await actualControl.probeGpuEngine(await closedUrl())).toBe("stopped");
  });
});

describe("/api/speech/engine", () => {
  async function loadRoute() {
    return import("@/app/api/speech/engine/route");
  }
  const put = (body: unknown) =>
    new Request("http://localhost/api/speech/engine", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  it("turning GPU off persists the setting and stops the engine; on starts it", async () => {
    const { PUT } = await loadRoute();
    const off = await PUT(put({ gpuAcceleration: false }));
    expect(off.status).toBe(200);
    expect(await off.json()).toMatchObject({ gpuAvailable: true, gpuAcceleration: false });
    expect(control.stopGpuEngine).toHaveBeenCalledTimes(1);
    expect(await resolveSpeechEngineTargets()).toEqual(["ws://127.0.0.1:6006"]);

    const on = await PUT(put({ gpuAcceleration: true }));
    expect(await on.json()).toMatchObject({ gpuAcceleration: true });
    expect(control.startGpuEngine).toHaveBeenCalledTimes(1);
  });

  it("still switches routing when engine control fails, and reports the error", async () => {
    (control.stopGpuEngine as jest.Mock).mockRejectedValueOnce(new Error("access denied"));
    const { PUT } = await loadRoute();
    const response = await PUT(put({ gpuAcceleration: false }));
    expect(await response.json()).toMatchObject({ gpuAcceleration: false, controlError: "access denied" });
    expect(await resolveSpeechEngineTargets()).toEqual(["ws://127.0.0.1:6006"]);
  });

  it("rejects bad bodies and hosts without a GPU engine", async () => {
    const { GET, PUT } = await loadRoute();
    expect((await PUT(put({ gpuAcceleration: "no" }))).status).toBe(400);
    delete process.env.SMART_NOTES_SPEECH_GPU_ENGINE_URL;
    expect((await PUT(put({ gpuAcceleration: false }))).status).toBe(409);
    expect(await (await GET()).json()).toMatchObject({ gpuAvailable: false });
  });
});
