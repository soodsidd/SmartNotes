/**
 * @jest-environment jsdom
 */
/**
 * Companion chat links open in a new tab and never replace the running
 * Smart Notes instance; in-message "#" anchors stay on the page.
 */
import * as React from "react";
import { render, screen } from "@testing-library/react";
import { ChatMarkdownLink } from "@/components/ai-sidebar";

jest.mock("react-markdown", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) =>
    require("react").createElement("div", null, children),
}));
jest.mock("remark-gfm", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("remark-math", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("rehype-katex", () => ({ __esModule: true, default: jest.fn() }));

describe("ChatMarkdownLink", () => {
  test.each(["https://example.com/paper", "/vault/Research/notes.pdf", "/?page=Inbox"])(
    "opens %s in a new tab with noopener",
    (href) => {
      render(<ChatMarkdownLink href={href}>link</ChatMarkdownLink>);
      const link = screen.getByRole("link", { name: "link" });
      expect(link.getAttribute("href")).toBe(href);
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toContain("noopener");
    }
  );

  test("keeps in-message anchors (footnotes) on the same page", () => {
    render(<ChatMarkdownLink href="#user-content-fn-1">1</ChatMarkdownLink>);
    expect(screen.getByRole("link", { name: "1" }).getAttribute("target")).toBeNull();
  });
});
