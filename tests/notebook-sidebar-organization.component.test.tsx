/**
 * @jest-environment jsdom
 */

import "@testing-library/jest-dom";
import * as React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { Sidebar } from "@/components/notebook-shell-reliable";
import type { VaultNotebook, VaultPage } from "@/lib/vault-contract";

jest.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
jest.mock("next/dynamic", () => () => () => null);
jest.mock("@/components/ai-sidebar", () => ({ AiSidebar: () => null, MobileAiSheet: () => null }));
jest.mock("@/components/rich-text-editor", () => ({ RichTextEditor: () => null }));

function page(path: string, title: string, parentId: string | null = null, keyNote = false): VaultPage {
  return {
    id: path, path, title, slug: path, createdAt: null, updatedAt: null,
    preview: "", content: "", parentId, noteType: "text", keyNote,
  };
}

const tree: VaultNotebook[] = [
  {
    id: "Work", path: "Work", name: "Work", color: "#008080", pages: [page("Work/Roadmap", "Roadmap")],
    sections: [{
      id: "Work/Research", path: "Work/Research", name: "Research", pages: [
        page("Work/Research/Parent", "Parent"),
        page("Work/Research/Laser", "Laser calibration", "Work/Research/Parent", true),
      ],
    }],
  },
  {
    id: "Personal", path: "Personal", name: "Personal", color: "#884488", pages: [page("Personal/Travel", "Travel plans", null, true)], sections: [],
  },
];

function renderSidebar(overrides: Partial<React.ComponentProps<typeof Sidebar>> = {}) {
  const props: React.ComponentProps<typeof Sidebar> = {
    tree,
    activeNotebookPath: null,
    activeSectionPath: null,
    activePagePath: null,
    expandedNotebooks: new Set(),
    expandedSections: new Set(),
    expandedPages: new Set(),
    closedNotebooks: new Set(),
    pinnedNotebooks: new Set(),
    pinnedPages: new Set(),
    notebookOrder: [],
    notebookGroups: [],
    archivedNotebooks: new Set(),
    onTogglePinnedNotebook: jest.fn(),
    onTogglePinnedPage: jest.fn(),
    onReorderNotebooks: jest.fn(),
    onCreateNotebookGroup: jest.fn(),
    onRenameNotebookGroup: jest.fn(),
    onDeleteNotebookGroup: jest.fn(),
    onToggleNotebookGroup: jest.fn(),
    onMoveNotebookToGroup: jest.fn(),
    onArchiveNotebook: jest.fn(),
    onUnarchiveNotebook: jest.fn(),
    onToggleNotebook: jest.fn(),
    onToggleSection: jest.fn(),
    onTogglePage: jest.fn(),
    onSelectNotebook: jest.fn(),
    onSelectSection: jest.fn(),
    onOpenPage: jest.fn(),
    onNestPage: jest.fn().mockResolvedValue(undefined),
    onSetPageKeyNote: jest.fn().mockResolvedValue(undefined),
    onReorderPages: jest.fn().mockResolvedValue(undefined),
    onApplyPageDrop: jest.fn().mockResolvedValue(undefined),
    onCreateNotebook: jest.fn(),
    onRevealNotebook: jest.fn(),
    onCreateSection: jest.fn(),
    onRenameNotebook: jest.fn(),
    onDeleteNotebook: jest.fn(),
    onCloseNotebook: jest.fn(),
    onOpenNotebook: jest.fn(),
    onCreatePage: jest.fn(),
    onCreateJupyterNotebook: jest.fn(),
    onCreateLogPage: jest.fn(),
    onCreateDesignPage: jest.fn(),
    onCreateSpreadsheetPage: jest.fn(),
    onLinkDesign: jest.fn(),
    onDirectCreatePage: jest.fn().mockResolvedValue(undefined),
    onImportDocx: jest.fn(),
    onRenameSection: jest.fn(),
    onDeleteSection: jest.fn(),
    onRenamePage: jest.fn(),
    onMovePage: jest.fn(),
    onDeletePage: jest.fn(),
    ghostVersions: null,
    onTogglePageVersions: jest.fn(),
    onPreviewGhostVersion: jest.fn(),
    previewedVersionId: null,
    onRestoreGhostVersion: jest.fn(),
    onDismissGhostVersions: jest.fn(),
    onExportPage: jest.fn(),
    onExportDocxPage: jest.fn(),
    ...overrides,
  };
  return { ...render(<Sidebar {...props} />), props };
}

describe("notebook picker organization component", () => {
  it("keeps organization chrome out of the tree and filters inside the picker", () => {
    renderSidebar();
    expect(screen.queryByTestId("notebook-picker-filter")).not.toBeInTheDocument();
    expect(screen.queryByTestId("key-notes-lens-toggle")).not.toBeInTheDocument();
    expect(screen.queryByTestId("notebook-group-ungrouped")).not.toBeInTheDocument();
    expect(screen.getByTestId("notebook-Work")).toBeInTheDocument();
    expect(screen.getByTestId("notebook-Personal")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("open-closed-notebook-btn"));
    fireEvent.change(screen.getByTestId("notebook-picker-filter"), { target: { value: "laser" } });
    expect(screen.getByTestId("picker-notebook-Work")).toBeInTheDocument();
    expect(screen.queryByTestId("picker-page-Work/Research/Parent")).not.toBeInTheDocument();
    expect(screen.queryByTestId("picker-page-Work/Research/Laser")).not.toBeInTheDocument();
    expect(screen.queryByTestId("picker-notebook-Personal")).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Clear notebook filter"));
    expect(screen.getByTestId("picker-notebook-Personal")).toBeInTheDocument();
    expect(screen.queryByTestId("picker-page-Work/Research/Laser")).not.toBeInTheDocument();
  });

  it("renders the key-note lens grouped by notebook", () => {
    renderSidebar();
    fireEvent.click(screen.getByTestId("open-closed-notebook-btn"));
    fireEvent.click(screen.getByTestId("key-notes-lens-toggle"));
    expect(screen.getByTestId("key-notes-lens")).toHaveTextContent("Work");
    expect(screen.getByTestId("key-notes-lens")).toHaveTextContent("Laser calibration");
    expect(screen.getByTestId("key-notes-lens")).toHaveTextContent("Personal");
    expect(screen.getByTestId("key-notes-lens")).not.toHaveTextContent("Roadmap");
  });

  it("collapses and expands the ungrouped notebook bucket", () => {
    renderSidebar();
    fireEvent.click(screen.getByTestId("open-closed-notebook-btn"));
    expect(screen.getByLabelText("Collapse Ungrouped")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("picker-notebook-Work")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Collapse Ungrouped"));
    expect(screen.queryByTestId("picker-notebook-Work")).not.toBeInTheDocument();
    expect(screen.queryByTestId("picker-notebook-Personal")).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Expand Ungrouped"));
    expect(screen.getByTestId("picker-notebook-Work")).toBeInTheDocument();
  });

  it("reopens a closed notebook when its notebook-only row is selected", () => {
    const onOpenNotebook = jest.fn();
    const onSelectNotebook = jest.fn();
    renderSidebar({
      closedNotebooks: new Set(["Work"]),
      onOpenNotebook,
      onSelectNotebook,
    });
    fireEvent.click(screen.getByTestId("open-closed-notebook-btn"));
    fireEvent.click(within(screen.getByTestId("picker-notebook-Work")).getByText("Work"));
    expect(onOpenNotebook).toHaveBeenCalledWith("Work");
    expect(onSelectNotebook).toHaveBeenCalledWith("Work");
  });

  it("keeps pinned items first without removing ordinary sidebar rows", () => {
    renderSidebar({
      pinnedNotebooks: new Set(["Work"]),
      pinnedPages: new Set(["Personal/Travel"]),
      expandedNotebooks: new Set(["Work"]),
    });
    expect(screen.getByTestId("notebook-Work")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("open-closed-notebook-btn"));
    const pinned = screen.getByTestId("pinned-section");
    expect(pinned).toHaveTextContent("Work");
    expect(pinned).toHaveTextContent("Travel plans");
    expect(pinned).toHaveTextContent("Personal");
    expect(screen.queryByTestId("picker-notebook-Work")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("picker-page-Personal/Travel")).toHaveLength(1);
    expect(pinned).toContainElement(screen.getByTestId("picker-page-Personal/Travel"));
  });

  it("pins a non-key-note page from the tree menu and exposes it in the picker", () => {
    const onTogglePinnedPage = jest.fn();
    const view = renderSidebar({
      expandedNotebooks: new Set(["Work"]),
      onTogglePinnedPage,
    });

    fireEvent.contextMenu(screen.getByTestId("page-Work/Roadmap"));
    fireEvent.click(screen.getByTestId("page-context-pin-Work/Roadmap"));
    expect(onTogglePinnedPage).toHaveBeenCalledWith("Work/Roadmap");

    view.rerender(<Sidebar {...view.props} pinnedPages={new Set(["Work/Roadmap"])} />);
    fireEvent.contextMenu(screen.getByTestId("page-Work/Roadmap"));
    expect(screen.getByTestId("page-context-pin-Work/Roadmap")).toHaveTextContent("Unpin page");
    fireEvent.click(screen.getByTestId("open-closed-notebook-btn"));
    const pinned = screen.getByTestId("pinned-section");
    expect(pinned).toHaveTextContent("Roadmap");
    expect(pinned).toHaveTextContent("Work");
  });

  it("renders persisted collapsible groups and temporarily opens matches", () => {
    const onToggleNotebookGroup = jest.fn();
    renderSidebar({
      onToggleNotebookGroup,
      notebookGroups: [{ id: "work", name: "Work group", notebookPaths: ["Work"], collapsed: true }],
    });
    expect(screen.queryByTestId("notebook-group-work")).not.toBeInTheDocument();
    expect(screen.queryByTestId("accordion-mode-toggle")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("open-closed-notebook-btn"));
    expect(screen.getByTestId("notebook-group-work")).toHaveTextContent("Work group");
    expect(screen.getByTestId("notebook-group-ungrouped")).toHaveTextContent("Ungrouped");
    expect(screen.queryByTestId("picker-notebook-Work")).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Expand Work group"));
    expect(onToggleNotebookGroup).toHaveBeenCalledWith("work");
    fireEvent.change(screen.getByTestId("notebook-picker-filter"), { target: { value: "laser" } });
    expect(screen.getByTestId("picker-notebook-Work")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Clear notebook filter"));
    expect(screen.queryByTestId("picker-notebook-Work")).not.toBeInTheDocument();
  });

  it("collapses and expands all notebook groups with one control", () => {
    const onToggleNotebookGroup = jest.fn();
    renderSidebar({
      onToggleNotebookGroup,
      notebookGroups: [{ id: "work", name: "Work group", notebookPaths: ["Work"], collapsed: true }],
    });
    fireEvent.click(screen.getByTestId("open-closed-notebook-btn"));
    expect(screen.getByLabelText("Collapse all groups")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("toggle-all-notebook-groups"));
    expect(screen.queryByTestId("picker-notebook-Personal")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Expand all groups")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("toggle-all-notebook-groups"));
    expect(onToggleNotebookGroup).toHaveBeenCalledWith("work");
    expect(screen.getByTestId("picker-notebook-Personal")).toBeInTheDocument();
  });

  it("keeps archived notebooks out of the tree and picker primary list", () => {
    const onUnarchiveNotebook = jest.fn();
    renderSidebar({
      archivedNotebooks: new Set(["Personal"]),
      onUnarchiveNotebook,
    });
    expect(screen.queryByTestId("notebook-Personal")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("open-closed-notebook-btn"));
    expect(screen.queryByTestId("picker-notebook-Personal")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("unarchive-notebook-Personal"));
    expect(onUnarchiveNotebook).toHaveBeenCalledWith("Personal");
  });
});
