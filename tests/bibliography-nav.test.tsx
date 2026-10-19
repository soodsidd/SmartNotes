/** @jest-environment jsdom */
import * as React from "react";
import "@testing-library/jest-dom";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { Bibliography, PaperCountButton } from "@/components/bibliography";
import { paperReferenceHtml } from "@/lib/papers";
import type { VaultNotebook, VaultPage } from "@/lib/vault-contract";

const firstId = "12345678-1234-4567-8123-123456789abc";
const secondId = "22345678-1234-4567-8123-123456789abc";
const otherId = "32345678-1234-4567-8123-123456789abc";

function page(path: string, title: string, content = "", paperId?: string): VaultPage {
  return { id: path, path, title, slug: path, content, preview: "", noteType: "text", createdAt: null, updatedAt: null, parentId: null, metadata: paperId ? { paper_id: paperId } : undefined };
}

const article = page("Research/Notes/Article.html", "Article", paperReferenceHtml(firstId) + paperReferenceHtml(secondId));
const tree: VaultNotebook[] = [
  { id: "Research", path: "Research", name: "Research", color: "", pages: [], sections: [{ id: "Notes", path: "Research/Notes", name: "Notes", pages: [article] }] },
  { id: ".bibliography", path: ".bibliography", name: "Bibliography", color: "", sections: [], pages: [page(`.bibliography/${firstId}.html`, "Alpha", "", firstId), page(`.bibliography/${secondId}.html`, "Beta", "", secondId), page(`.bibliography/${otherId}.html`, "Gamma", "", otherId)] },
];

function Harness() {
  const [open, setOpen] = React.useState(false);
  const [filterPage, setFilterPage] = React.useState<{ path: string; title: string } | null>(null);
  return <>
    <PaperCountButton page={article} count={2} compact={false} onClick={() => { setFilterPage({ path: article.path, title: article.title }); setOpen(true); }} />
    <Bibliography tree={tree} loading={false} compact={false} onOpen={() => {}} open={open} filterPage={filterPage} onClearFilter={() => setFilterPage(null)} onToggle={() => {
      if (filterPage) { setFilterPage(null); setOpen(true); }
      else setOpen(!open);
    }} />
  </>;
}

test("paper count opens the central Bibliography scoped to its page and clearing restores all papers", () => {
  render(<Harness />);
  const count = screen.getByRole("button", { name: "Show 2 papers referenced by Article" });
  expect(count.textContent).toContain("2");
  expect(count.querySelector("svg")?.classList.contains("text-paper")).toBe(true);
  fireEvent.click(count);
  const library = screen.getByTestId("bibliography-library");
  expect(screen.getByTestId("bibliography-toggle").getAttribute("aria-expanded")).toBe("true");
  expect(within(library).getByText("Alpha")).toBeTruthy();
  expect(within(library).getByText("Beta")).toBeTruthy();
  expect(within(library).queryByText("Gamma")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Clear filter" }));
  expect(within(library).getByText("Gamma")).toBeTruthy();
  fireEvent.click(count);
  fireEvent.click(screen.getByTestId("bibliography-toggle"));
  expect(screen.queryByTestId("bibliography-page-filter")).toBeNull();
  expect(within(library).getByText("Gamma")).toBeTruthy();
});
