/**
 * @jest-environment jsdom
 *
 * Settings switch for dictation GPU acceleration (PC-wide, server-backed).
 */

import "@testing-library/jest-dom";
import * as React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { DictationGpuSetting } from "@/components/dictation-gpu-setting";

type Status = { gpuAvailable: boolean; gpuAcceleration: boolean; gpuEngine: "running" | "stopped"; controlError?: string };

function mockFetch(initial: Status, afterPut?: Status) {
  const calls: { method: string; body?: unknown }[] = [];
  global.fetch = jest.fn(async (_url: unknown, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const payload = method === "PUT" ? afterPut ?? initial : initial;
    return { ok: true, json: async () => payload } as Response;
  }) as unknown as typeof fetch;
  return calls;
}

describe("DictationGpuSetting", () => {
  it("is hidden when the host has no GPU engine", async () => {
    mockFetch({ gpuAvailable: false, gpuAcceleration: true, gpuEngine: "stopped" });
    render(<DictationGpuSetting open />);
    await act(async () => undefined);
    expect(screen.queryByTestId("settings-dictation-gpu")).not.toBeInTheDocument();
  });

  it("shows the current state and turning it off sends gpuAcceleration=false", async () => {
    const calls = mockFetch(
      { gpuAvailable: true, gpuAcceleration: true, gpuEngine: "running" },
      { gpuAvailable: true, gpuAcceleration: false, gpuEngine: "stopped" }
    );
    render(<DictationGpuSetting open />);
    const toggle = await screen.findByTestId("settings-dictation-gpu-toggle");
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("settings-dictation-gpu-status")).toHaveTextContent("GPU engine running");

    await act(async () => {
      fireEvent.click(toggle);
    });
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "false"));
    expect(calls.find((call) => call.method === "PUT")?.body).toEqual({ gpuAcceleration: false });
    expect(screen.getByTestId("settings-dictation-gpu-status")).toHaveTextContent("CPU engine");
  });

  it("surfaces an engine control error", async () => {
    mockFetch(
      { gpuAvailable: true, gpuAcceleration: true, gpuEngine: "running" },
      { gpuAvailable: true, gpuAcceleration: false, gpuEngine: "stopped", controlError: "access denied" }
    );
    render(<DictationGpuSetting open />);
    const toggle = await screen.findByTestId("settings-dictation-gpu-toggle");
    await act(async () => {
      fireEvent.click(toggle);
    });
    expect(await screen.findByTestId("settings-dictation-gpu-error")).toHaveTextContent("access denied");
  });
});
