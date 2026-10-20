/**
 * @jest-environment jsdom
 *
 * SN-324 cycle 3 — mobile drill-down model
 * Verifies: burger opens rail view; section tap drills to section-pages view;
 * Back button returns to rail; page tap closes sheet; desktop panes unaffected.
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

function page(path: string, title: string): VaultPage {
  return {
    id: path, path, title, slug: path, createdAt: null, updatedAt: null,
    preview: "", content: "", parentId: null, noteType: "text", keyNote: false,
  };
}

const tree: VaultNotebook[] = [
  {
    id: "Work", path: "Work", name: "Work", color: "#008080",
    pages: [page("Work/Overview", "Overview")],
    sections: [
      { id: "Work/Research", path: "Work/Research", name: "Research", pages: [page("Work/Research/Note1", "Note 1"), page("Work/Research/Note2", "Note 2")] },
      { id: "Work/Design", path: "Work/Design", name: "Design", pages: [page("Work/Design/Spec", "Spec")] },
    ],
  },
  {
    id: "Personal", path: "Personal", name: "Personal", color: "#884488",
    pages: [page("Personal/Journal", "Journal")],
    sections: [],
  },
];

type SheetView = "rail" | "section-pages";

/** Minimal stateful harness matching the Shell's mobile sheet state machine */
function MobileDrillHarness({ onOpenPage = jest.fn() }: { onOpenPage?: (path: string) => void }) {
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [view, setView] = React.useState<SheetView>("rail");
  const [drillPath, setDrillPath] = React.useState<string | null>(null);
  const [drillNotebookPath, setDrillNotebookPath] = React.useState<string | null>(null);

  const openSheet = () => { setView("rail"); setDrillPath(null); setDrillNotebookPath(null); setSheetOpen(true); };
  const closeSheet = () => setSheetOpen(false);
  const drillTo = (path: string) => { setDrillNotebookPath("Work"); setDrillPath(path); setView("section-pages"); };
  const drillToRoot = (path: string) => { setDrillNotebookPath(path); setDrillPath(null); setView("section-pages"); };
  const backToRail = () => { setView("rail"); setDrillPath(null); setDrillNotebookPath(null); };

  const sectionName = drillPath
    ? tree.flatMap((nb) => nb.sections).find((s) => s.path === drillPath)?.name ?? drillPath
    : "Notebook pages";

  const baseProps = {
    tree,
    activeNotebookPath: "Work",
    activeSectionPath: null,
    activePagePath: null,
    expandedNotebooks: new Set(["Work"]),
    expandedSections: new Set<string>(),
    expandedPages: new Set<string>(),
    closedNotebooks: new Set<string>(),
    pinnedNotebooks: new Set<string>(),
    pinnedPages: new Set<string>(),
    notebookOrder: [] as string[],
    notebookGroups: [] as [],
    archivedNotebooks: new Set<string>(),
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
    onNestPage: jest.fn().mockResolvedValue(undefined),
    onSetPageKeyNote: jest.fn().mockResolvedValue(undefined),
    onReorderPages: jest.fn().mockResolvedValue(undefined),
    onApplyPageDrop: jest.fn().mockResolvedValue(undefined),
    onCrossContainerPageDrop: jest.fn().mockResolvedValue(undefined),
    onCreateNotebook: jest.fn(),
    onRevealNotebook: jest.fn(),
    onCreateSection: jest.fn(),
    inlineSectionPath: null,
    onCommitSectionName: jest.fn().mockResolvedValue(undefined),
    inlinePageTitlePath: null,
    onCommitPageTitle: jest.fn().mockResolvedValue(undefined),
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
  };

  return (
    <div>
      <button onClick={openSheet} data-testid="burger">Open</button>
      {sheetOpen && (
        <div data-testid="mobile-sheet">
          {view === "rail" ? (
            <div data-testid="sheet-rail-view">
              <span>Notes</span>
              <Sidebar
                {...baseProps}
                sidebarLayout="rail"
                onSelectSection={(path) => { baseProps.onSelectSection(path); drillTo(path); }}
                onSelectRootPages={drillToRoot}
                onOpenPage={(path) => { onOpenPage(path); closeSheet(); }}
              />
            </div>
          ) : (
            <div data-testid="sheet-section-pages-view">
              <button onClick={backToRail} data-testid="mobile-drill-back" aria-label="Back to notebooks">Back</button>
              <span data-testid="drilled-section-name">{sectionName}</span>
              <Sidebar
                {...baseProps}
                sidebarLayout="page-tree"
                tree={tree}
                pageScope={drillNotebookPath ? { notebookPath: drillNotebookPath, sectionPath: drillPath } : null}
                expandedSections={new Set(drillPath ? [drillPath] : [])}
                onOpenPage={(path) => { onOpenPage(path); closeSheet(); }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

describe("SN-324 mobile drill-down model", () => {
  it("burger opens sheet in rail view", () => {
    render(<MobileDrillHarness />);
    expect(screen.queryByTestId("mobile-sheet")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("burger"));
    expect(screen.getByTestId("sheet-rail-view")).toBeInTheDocument();
    expect(screen.queryByTestId("sheet-section-pages-view")).not.toBeInTheDocument();
  });

  it("rail view shows sections for active notebook", () => {
    render(<MobileDrillHarness />);
    fireEvent.click(screen.getByTestId("burger"));
    expect(screen.getByTestId("rail-section-row-Work/Research")).toBeInTheDocument();
    expect(screen.getByTestId("rail-section-row-Work/Design")).toBeInTheDocument();
  });

  it("tapping a section drills to section-pages view", () => {
    render(<MobileDrillHarness />);
    fireEvent.click(screen.getByTestId("burger"));
    fireEvent.click(screen.getByTestId("rail-section-row-Work/Research"));
    expect(screen.getByTestId("sheet-section-pages-view")).toBeInTheDocument();
    expect(screen.queryByTestId("sheet-rail-view")).not.toBeInTheDocument();
  });

  it("section-pages view shows only the drilled section name", () => {
    render(<MobileDrillHarness />);
    fireEvent.click(screen.getByTestId("burger"));
    fireEvent.click(screen.getByTestId("rail-section-row-Work/Research"));
    expect(screen.getByTestId("drilled-section-name")).toHaveTextContent("Research");
    expect(screen.queryByTestId("page-pane-section-heading")).not.toBeInTheDocument();
    expect(screen.getAllByText("Research")).toHaveLength(1);
  });

  it("section-pages view shows only pages of the drilled section", () => {
    render(<MobileDrillHarness />);
    fireEvent.click(screen.getByTestId("burger"));
    fireEvent.click(screen.getByTestId("rail-section-row-Work/Research"));
    expect(screen.getByTestId("page-Work/Research/Note1")).toBeInTheDocument();
    expect(screen.getByTestId("page-Work/Research/Note2")).toBeInTheDocument();
    expect(screen.queryByTestId("page-Work/Design/Spec")).not.toBeInTheDocument();
  });

  it("root pages drill into the same sheet and Back returns to the rail", () => {
    render(<MobileDrillHarness />);
    fireEvent.click(screen.getByTestId("burger"));
    fireEvent.click(screen.getByTestId("rail-root-pages-Work"));
    expect(screen.getByTestId("sheet-section-pages-view")).toBeInTheDocument();
    expect(screen.getByTestId("page-Work/Overview")).toBeInTheDocument();
    expect(screen.queryByTestId("page-pane-root-heading")).not.toBeInTheDocument();
    expect(screen.queryByTestId("page-Work/Research/Note1")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("mobile-drill-back"));
    expect(screen.getByTestId("sheet-rail-view")).toBeInTheDocument();
  });

  it("back button returns to rail view", () => {
    render(<MobileDrillHarness />);
    fireEvent.click(screen.getByTestId("burger"));
    fireEvent.click(screen.getByTestId("rail-section-row-Work/Research"));
    expect(screen.getByTestId("sheet-section-pages-view")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("mobile-drill-back"));
    expect(screen.getByTestId("sheet-rail-view")).toBeInTheDocument();
    expect(screen.queryByTestId("sheet-section-pages-view")).not.toBeInTheDocument();
  });

  it("page tap calls onOpenPage and closes sheet", () => {
    const onOpenPage = jest.fn();
    render(<MobileDrillHarness onOpenPage={onOpenPage} />);
    fireEvent.click(screen.getByTestId("burger"));
    fireEvent.click(screen.getByTestId("rail-section-row-Work/Research"));
    const expandedSection = screen.getByTestId("section-Work/Research");
    fireEvent.click(within(expandedSection).getByTestId("page-Work/Research/Note1"));
    expect(onOpenPage).toHaveBeenCalledWith("Work/Research/Note1");
    expect(screen.queryByTestId("mobile-sheet")).not.toBeInTheDocument();
  });

  it("re-opening sheet resets to rail view", () => {
    render(<MobileDrillHarness />);
    fireEvent.click(screen.getByTestId("burger"));
    fireEvent.click(screen.getByTestId("rail-section-row-Work/Research"));
    expect(screen.getByTestId("sheet-section-pages-view")).toBeInTheDocument();
    // Close by clicking back, then reopen
    fireEvent.click(screen.getByTestId("mobile-drill-back"));
    fireEvent.click(screen.getByTestId("rail-section-row-Work/Design"));
    expect(screen.getByTestId("drilled-section-name")).toHaveTextContent("Design");
    expect(screen.queryByTestId("page-Work/Research/Note1")).not.toBeInTheDocument();
    expect(screen.getByTestId("page-Work/Design/Spec")).toBeInTheDocument();
  });
});
