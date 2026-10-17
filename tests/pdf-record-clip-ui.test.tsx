/** @jest-environment jsdom */
import * as React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { PdfRecordPanel, invokePdfRecord } from "@/components/pdf-record-panel";
import { InlineAiPopover } from "@/components/inline-ai-popover";
import { PdfCropLayer } from "@/components/pdf-crop-layer";
import { invokeInlineAi } from "@/lib/inline-ai";
import type { PdfCropFraction } from "@/lib/pdf-record";

const source = { pdfPath: "Research/scan.pdf", pdfTitle: "Scan", page: 4, quote: null, clip: { kind: "area" as const, width: 900, height: 600 } };

beforeAll(() => {
  global.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} };
  // jsdom has no PointerEvent; a MouseEvent subclass keeps clientX/pointerId.
  class TestPointerEvent extends MouseEvent {
    pointerId: number; pointerType: string; isPrimary: boolean;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1; this.pointerType = init.pointerType ?? "mouse"; this.isPrimary = init.isPrimary ?? true;
    }
  }
  Object.defineProperty(window, "PointerEvent", { configurable: true, value: TestPointerEvent });
});

beforeEach(() => {
  sessionStorage.clear();
  Object.defineProperty(globalThis, "crypto", { configurable: true, value: { randomUUID: () => "7d0c6f1e-2b8a-4c1f-9e8d-3a5b6c7d8e9f" } });
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: jest.fn(() => "blob:clip-preview") });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: jest.fn() });
});

it("previews a rendered clip before saving and retries the same id, image and destination", async () => {
  sessionStorage.setItem("smart-notes-pdf-record:Research/scan.pdf", "Research/remembered.html");
  const posts: Array<{ record: Record<string, unknown>; image: File }> = [];
  global.fetch = jest.fn(async (url, init) => {
    if (String(url) === "/api/vault") return { ok: true, json: async () => ({ tree: [] }) } as Response;
    const form = init?.body as FormData;
    posts.push({ record: JSON.parse(String(form.get("record"))), image: form.get("image") as File });
    if (posts.length === 1) return { ok: false, json: async () => ({ error: "Network lost" }) } as Response;
    return { ok: true, json: async () => ({ path: "Research/remembered.html" }) } as Response;
  }) as typeof fetch;
  const image = new Blob(["png"], { type: "image/png" });
  render(<PdfRecordPanel onOpenNote={jest.fn()} />);
  act(() => invokePdfRecord({ source, defaultDestinationPath: "Research/default.html", image }));

  expect(screen.getByRole("dialog", { name: "Record PDF area" })).toBeVisible();
  expect(screen.getByTestId("pdf-record-clip-preview")).toHaveAttribute("src", "blob:clip-preview");
  expect(screen.getByTestId("pdf-record-clip-preview")).toHaveAttribute("alt", "Figure area from Scan, page 4");
  expect(screen.getByText(/900×600px, rendered from the PDF/)).toBeVisible();
  expect(posts).toHaveLength(0); // never a silent one-tap save for image clips
  expect(screen.getByLabelText("Save in")).toHaveValue("Research/remembered.html");

  fireEvent.click(screen.getByRole("button", { name: "Record", exact: true }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Network lost");
  fireEvent.click(screen.getByRole("button", { name: /Retry in Research\/remembered.html/ }));
  await waitFor(() => expect(screen.getByText(/Saved in Research\/remembered.html/)).toBeInTheDocument());
  expect(posts).toHaveLength(2);
  expect(posts[1].record).toEqual(posts[0].record);
  expect(posts[0].record).toMatchObject({ destinationPath: "Research/remembered.html", page: 4, quote: null, clip: source.clip });
  expect(posts[0].image).toBeInstanceOf(Blob);
  expect(posts[1].image.size).toBe(image.size);
});

it("ignores a clip invocation that arrives without its rendered image", () => {
  render(<PdfRecordPanel onOpenNote={jest.fn()} />);
  act(() => invokePdfRecord({ source, defaultDestinationPath: "Research/default.html" }));
  expect(screen.queryByTestId("pdf-record-panel")).toBeNull();
});

it("offers Record area and Record page from the PDF page menu", () => {
  render(<InlineAiPopover pagePath="Notes/pdf.html" onContinue={jest.fn()} />);
  const pdfClip = { area: jest.fn(), page: jest.fn() };
  act(() => invokeInlineAi({ context: { surface: "pdf", target: "PDF page", text: "", pageText: "", tableText: "" }, x: 10, y: 10, menu: true, pdfClip }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Record area" }));
  expect(pdfClip.area).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("menu")).toBeNull();
  act(() => invokeInlineAi({ context: { surface: "pdf", target: "PDF page", text: "", pageText: "", tableText: "" }, x: 10, y: 10, menu: true, pdfClip }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Record page" }));
  expect(pdfClip.page).toHaveBeenCalledTimes(1);
});

function CropHarness({ onChange, onOuter }: { onChange: (crop: PdfCropFraction | null) => void; onOuter: () => void }) {
  const [crop, setCrop] = React.useState<PdfCropFraction | null>(null);
  return (
    <div onPointerDown={onOuter} onClick={onOuter}>
      <PdfCropLayer crop={crop} pageNumber={2} onCropChange={(next) => { setCrop(next); onChange(next); }} />
    </div>
  );
}

it("draws an intentional area by drag without leaking the gesture to the page or chrome", () => {
  const changes: Array<PdfCropFraction | null> = [];
  const outer = jest.fn();
  render(<CropHarness onChange={(crop) => changes.push(crop)} onOuter={outer} />);
  const layer = screen.getByTestId("pdf-reader-crop-layer");
  layer.getBoundingClientRect = () => ({ left: 100, top: 50, width: 400, height: 500, right: 500, bottom: 550, x: 100, y: 50, toJSON: () => ({}) });
  fireEvent.pointerDown(layer, { pointerId: 1, pointerType: "touch", clientX: 140, clientY: 100, button: 0 });
  fireEvent.pointerMove(layer, { pointerId: 1, pointerType: "touch", clientX: 340, clientY: 350 });
  fireEvent.pointerUp(layer, { pointerId: 1, pointerType: "touch", clientX: 340, clientY: 350 });
  fireEvent.click(layer);
  const last = changes[changes.length - 1]!;
  expect(last.x).toBeCloseTo(0.1);
  expect(last.y).toBeCloseTo(0.1);
  expect(last.width).toBeCloseTo(0.5);
  expect(last.height).toBeCloseTo(0.5);
  expect(screen.getByTestId("pdf-reader-crop-rect")).toHaveStyle({ left: "10%", top: "10%" });
  expect(outer).not.toHaveBeenCalled();
});

it("supports a keyboard-only crop", () => {
  const changes: Array<PdfCropFraction | null> = [];
  render(<CropHarness onChange={(crop) => changes.push(crop)} onOuter={jest.fn()} />);
  const layer = screen.getByRole("group", { name: /Select an area on page 2/ });
  expect(layer).toHaveFocus();
  fireEvent.keyDown(layer, { key: "Enter" });
  fireEvent.keyDown(layer, { key: "ArrowRight", shiftKey: true });
  expect(changes[changes.length - 1]).toMatchObject({ x: 0.2, y: 0.2, height: 0.6 });
  expect(changes[changes.length - 1]!.width).toBeCloseTo(0.62);
});
