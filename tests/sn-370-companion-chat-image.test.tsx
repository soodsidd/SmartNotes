/**
 * @jest-environment jsdom
 */
/**
 * SN-370: inline Companion chat image — bounded, alt text, fallback on failure.
 */
import * as React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { CompanionChatImage } from "@/components/ai-sidebar";

jest.mock("react-markdown", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) =>
    require("react").createElement("div", null, children),
}));
jest.mock("remark-gfm", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("remark-math", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("rehype-katex", () => ({ __esModule: true, default: jest.fn() }));

describe("CompanionChatImage", () => {
  test("renders a lazy image with alt text, linked to the full-size original", () => {
    render(<CompanionChatImage src="/vault/.companion-images/2026-10/a.png" alt="Unit circle" />);
    const img = screen.getByRole("img", { name: "Unit circle" });
    expect(img.getAttribute("src")).toBe("/vault/.companion-images/2026-10/a.png");
    expect(img.getAttribute("loading")).toBe("lazy");
    const link = screen.getByTestId("companion-chat-image");
    expect(link.getAttribute("href")).toBe("/vault/.companion-images/2026-10/a.png");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.classList.contains("companion-chat-image")).toBe(true);
  });

  test("shows a readable fallback when the image fails to load", () => {
    render(<CompanionChatImage src="/vault/missing.png" alt="Generated chart" />);
    fireEvent.error(screen.getByRole("img", { name: "Generated chart" }));
    expect(screen.getByTestId("companion-chat-image-fallback").textContent).toContain("Image unavailable: Generated chart");
    expect(screen.queryByTestId("companion-chat-image")).toBeNull();
  });

  test("falls back when there is no src", () => {
    render(<CompanionChatImage alt="" />);
    expect(screen.getByTestId("companion-chat-image-fallback").textContent).toContain("Image unavailable");
  });
});
