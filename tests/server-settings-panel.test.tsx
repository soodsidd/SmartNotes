/**
 * @jest-environment jsdom
 * @jest-environment-options {"url": "http://localhost:3002/"}
 */
import "@testing-library/jest-dom";
import * as React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ServerSettingsPanel } from "@/components/server-settings-panel";

const running = {
  status: "running",
  address: "http://localhost:3002",
  reachable: true,
  pid: 34304,
  uptimeSeconds: 3170,
  build: "DhATPDCX0G7dBb4zsyPLY",
  log: "",
};

function json(body: unknown, ok = true) {
  return Promise.resolve({ ok, status: ok ? 200 : 409, json: async () => body });
}

describe("Settings Server tab", () => {
  beforeEach(() => window.localStorage.clear());

  describe("without the supervisor", () => {
    beforeEach(() => {
      global.fetch = jest.fn((url: string) =>
        url === "/api/server/status" ? json({ ...running, supervised: false, controlPort: null }) : Promise.reject(new Error("refused"))
      ) as jest.Mock;
    });

    it("renders the reference labels and live values in order", async () => {
      render(<ServerSettingsPanel />);
      await waitFor(() => expect(screen.getByText("34304")).toBeInTheDocument());
      expect(screen.getByTestId("server-status-pill")).toHaveTextContent("Running");
      expect(screen.getByText("52m 50s")).toBeInTheDocument();
      expect(screen.getByText("DhATPDCX0G7dBb4zsyPLY")).toBeInTheDocument();
      expect(screen.getByText("All edits are synced to the vault on disk.")).toBeInTheDocument();
      const rows = [...document.querySelectorAll("dt")].map((node) => node.textContent);
      expect(rows).toEqual(["Address", "Reachable", "Process", "Uptime", "Build"]);
      expect(screen.getByTestId("server-stop")).toBeDisabled();
      expect(screen.getByTestId("server-notice")).toHaveTextContent("supervisor");
    });

    it("starts with the server log collapsed and exposes it by keyboard button", async () => {
      render(<ServerSettingsPanel />);
      await waitFor(() => expect(screen.getByText("34304")).toBeInTheDocument());
      const toggle = screen.getByTestId("server-log-toggle");
      expect(toggle).toHaveAttribute("aria-expanded", "false");
      expect(screen.queryByTestId("server-log")).toBeNull();
      fireEvent.click(toggle);
      expect(toggle).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByTestId("server-log")).toBeVisible();
    });
  });

  describe("with the supervisor", () => {
    let state: Record<string, unknown>;

    beforeEach(() => {
      state = { ...running, supervised: true, log: "> Ready on http://localhost:3002\n" };
      global.fetch = jest.fn((url: string, init?: RequestInit) => {
        if (url === "http://localhost:3010/status") return json(state);
        if (url === "http://localhost:3010/stop" && init?.method === "POST") {
          state = { ...state, status: "stopped", reachable: false, pid: null, uptimeSeconds: null };
          return json(state);
        }
        if (url === "http://localhost:3010/start" && init?.method === "POST") {
          state = { ...state, status: "running", reachable: true, pid: 40000, uptimeSeconds: 0 };
          return json(state);
        }
        return Promise.reject(new Error(`unexpected ${url}`));
      }) as jest.Mock;
    });

    it("stops and then starts the server while the app server is down", async () => {
      render(<ServerSettingsPanel />);
      await waitFor(() => expect(screen.getByTestId("server-stop")).toBeEnabled());
      expect(screen.getByTestId("server-start")).toBeDisabled();

      fireEvent.click(screen.getByTestId("server-stop"));
      await waitFor(() => expect(screen.getByTestId("server-status-pill")).toHaveTextContent("Stopped"));
      expect(screen.getByText("No")).toBeInTheDocument();
      await waitFor(() => expect(screen.getByTestId("server-start")).toBeEnabled());

      fireEvent.click(screen.getByTestId("server-start"));
      await waitFor(() => expect(screen.getByText("40000")).toBeInTheDocument());
      expect(screen.getByTestId("server-status-pill")).toHaveTextContent("Running");
      expect(global.fetch).not.toHaveBeenCalledWith("/api/server/status", expect.anything());
    });

    it("shows the tail of the supervisor log", async () => {
      render(<ServerSettingsPanel />);
      await waitFor(() => expect(screen.getByTestId("server-stop")).toBeEnabled());
      fireEvent.click(screen.getByTestId("server-log-toggle"));
      expect(screen.getByTestId("server-log")).toHaveTextContent("Ready on http://localhost:3002");
    });
  });
});
