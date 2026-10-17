/** @jest-environment jsdom */
import * as React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { PdfRecordPanel, invokePdfRecord } from "@/components/pdf-record-panel";

const source = { pdfPath: "Research/one.pdf", pdfTitle: "One PDF", page: 2, quote: " Exact\npassage " };

beforeEach(() => {
  sessionStorage.clear();
  Object.defineProperty(globalThis, "crypto", { configurable: true, value: { randomUUID: () => "54c2a31a-734f-43b7-ab1e-d95fb5d93353" } });
});

it("keeps a pending or failed one-tap write visible and retries the same ID and destination", async () => {
  let finish!: (response: Response) => void;
  const requests: Array<{ url: string; body: { id: string; destinationPath: string } }> = [];
  global.fetch = jest.fn(async (url, init) => {
    const address = String(url);
    if (address === "/api/vault") return { ok: true, json: async () => ({ tree: [] }) } as Response;
    requests.push({ url: address, body: JSON.parse(String(init?.body)) });
    if (requests.length === 1) return new Promise<Response>(resolve => { finish = resolve; });
    return { ok: true, json: async () => ({ path: "Research/first.html" }) } as Response;
  }) as typeof fetch;
  const opened = jest.fn();
  render(<PdfRecordPanel onOpenNote={opened} />);
  act(() => invokePdfRecord({ source, defaultDestinationPath: "Research/first.html", quick: true }));
  expect(screen.getByRole("status")).toHaveTextContent("Saving");
  expect(screen.queryByText(/Saved in/)).not.toBeInTheDocument();
  expect(screen.getByLabelText("Close Record panel")).toBeDisabled();
  act(() => invokePdfRecord({ source, defaultDestinationPath: "Research/second.html", quick: true }));
  expect(requests).toHaveLength(1);
  await act(async () => finish({ ok: false, json: async () => ({ error: "Network lost" }) } as Response));
  expect(screen.getByRole("alert")).toHaveTextContent("Network lost");
  fireEvent.click(screen.getByRole("button", { name: /Retry in Research\/first.html/ }));
  await waitFor(() => expect(screen.getByText(/Saved in Research\/first.html/)).toBeInTheDocument());
  expect(requests.map(request => request.body)).toEqual([requests[0].body, requests[0].body]);
  fireEvent.click(screen.getByRole("button", { name: "Open note" }));
  expect(opened).toHaveBeenCalledWith("Research/first.html");
});

it("remembers an override for the PDF session and includes typed thought", async () => {
  const requests: Array<{ body: { destinationPath: string; thought: string } }> = [];
  global.fetch = jest.fn(async (url, init) => {
    if (String(url) === "/api/vault") return { ok: true, json: async () => ({ tree: [{ pages: [{ path: "Research/other.html", title: "Other" }], sections: [] }] }) } as Response;
    requests.push({ body: JSON.parse(String(init?.body)) });
    return { ok: true, json: async () => ({ path: "Research/other.html" }) } as Response;
  }) as typeof fetch;
  render(<PdfRecordPanel onOpenNote={jest.fn()} />);
  act(() => invokePdfRecord({ source, defaultDestinationPath: "Research/first.html" }));
  await screen.findByRole("option", { name: /Other/ });
  fireEvent.change(screen.getByLabelText("Save in"), { target: { value: "Research/other.html" } });
  fireEvent.change(screen.getByLabelText("Your thought (optional)"), { target: { value: "My thought" } });
  fireEvent.click(screen.getByRole("button", { name: "Record", exact: true }));
  await waitFor(() => expect(requests).toHaveLength(1));
  expect(requests[0].body).toMatchObject({ destinationPath: "Research/other.html", thought: "My thought" });
  expect(sessionStorage.getItem("smart-notes-pdf-record:Research/one.pdf")).toBe("Research/other.html");
});
