"use client";

import * as React from "react";
import {
  Archive,
  ChevronDown,
  ChevronRight,
  Gem,
  GripVertical,
  ListCollapse,
  MoreHorizontal,
  Pin,
  PinOff,
  Search,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { isPageKeyNote } from "@/lib/key-note";
import {
  buildNotebookPresentationRows,
  collectKeyNoteEntries,
  filterNotebookTree,
  sortNotebooksByOverride,
  type NotebookGroup,
} from "@/lib/notebook-sidebar-organization";
import { cn } from "@/lib/utils";
import type { VaultNotebook, VaultPage } from "@/lib/vault-contract";

interface NotebookPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tree: VaultNotebook[];
  closedNotebooks: Set<string>;
  archivedNotebooks: Set<string>;
  pinnedNotebooks: Set<string>;
  pinnedPages: Set<string>;
  notebookOrder: string[];
  notebookGroups: NotebookGroup[];
  onTogglePinnedNotebook: (path: string) => void;
  onTogglePinnedPage: (path: string) => void;
  onReorderNotebooks: (sourcePath: string, targetPath: string) => void;
  onCreateNotebookGroup: (name: string) => void;
  onRenameNotebookGroup: (id: string, name: string) => void;
  onDeleteNotebookGroup: (id: string) => void;
  onToggleNotebookGroup: (id: string) => void;
  onMoveNotebookToGroup: (notebookPath: string, groupId: string | null) => void;
  onArchiveNotebook: (path: string) => void;
  onUnarchiveNotebook: (path: string) => void;
  onOpenNotebook: (path: string) => void;
  onSelectNotebook: (path: string) => void;
  onOpenPage: (path: string) => void;
}

function pageEntries(notebooks: VaultNotebook[]) {
  return notebooks.flatMap((notebook) => [
    ...notebook.pages.map((page) => ({ notebook, page })),
    ...notebook.sections.flatMap((section) => section.pages.map((page) => ({ notebook, page }))),
  ]);
}

function PickerPageRow({
  page,
  notebookName,
  depth = 0,
  pinned,
  onOpen,
  onTogglePin,
}: {
  page: VaultPage;
  notebookName?: string;
  depth?: number;
  pinned: boolean;
  onOpen: () => void;
  onTogglePin: () => void;
}) {
  return (
    <div
      className="flex min-h-11 items-center gap-1 rounded-md hover:bg-surface focus-within:ring-2 focus-within:ring-ring"
      style={{ paddingLeft: depth * 12 }}
      data-testid={`picker-page-${page.path}`}
    >
      <button
        type="button"
        className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left focus-visible:outline-none"
        onClick={onOpen}
      >
        {isPageKeyNote(page) ? <Gem className="size-3.5 shrink-0 text-accent" aria-label="Key note" /> : <span className="w-3.5" />}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{page.title}</span>
          {notebookName ? <span className="block truncate text-xs text-muted-foreground">{notebookName}</span> : null}
        </span>
      </button>
      <button
        type="button"
        className="flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={onTogglePin}
        aria-label={`${pinned ? "Unpin" : "Pin"} ${page.title}`}
      >
        {pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
      </button>
    </div>
  );
}

export function OpenClosedNotebooksDialog(props: NotebookPickerProps) {
  const {
    open,
    onOpenChange,
    tree,
    closedNotebooks,
    archivedNotebooks,
    pinnedNotebooks,
    pinnedPages,
    notebookOrder,
    notebookGroups,
    onTogglePinnedNotebook,
    onTogglePinnedPage,
    onReorderNotebooks,
    onCreateNotebookGroup,
    onRenameNotebookGroup,
    onDeleteNotebookGroup,
    onToggleNotebookGroup,
    onMoveNotebookToGroup,
    onArchiveNotebook,
    onUnarchiveNotebook,
    onOpenNotebook,
    onSelectNotebook,
    onOpenPage,
  } = props;
  const [filterQuery, setFilterQuery] = React.useState("");
  const [keyNotesLens, setKeyNotesLens] = React.useState(false);
  const [ungroupedCollapsed, setUngroupedCollapsed] = React.useState(false);
  const [draggedNotebookPath, setDraggedNotebookPath] = React.useState<string | null>(null);
  const [groupDialog, setGroupDialog] = React.useState<{
    mode: "create" | "rename";
    id?: string;
    value: string;
  } | null>(null);

  const availableNotebooks = React.useMemo(
    () => sortNotebooksByOverride(
      tree.filter((notebook) => !archivedNotebooks.has(notebook.path)),
      notebookOrder
    ),
    [archivedNotebooks, notebookOrder, tree]
  );
  const archivedList = React.useMemo(
    () => sortNotebooksByOverride(
      tree.filter((notebook) => archivedNotebooks.has(notebook.path)),
      notebookOrder
    ),
    [archivedNotebooks, notebookOrder, tree]
  );
  const filterResult = React.useMemo(
    () => filterNotebookTree(availableNotebooks, filterQuery),
    [availableNotebooks, filterQuery]
  );
  const filteredPagePaths = React.useMemo(
    () => new Set(pageEntries(filterResult.tree).map(({ page }) => page.path)),
    [filterResult.tree]
  );
  const pinnedNotebookEntries = React.useMemo(
    () => filterResult.tree.filter((notebook) => pinnedNotebooks.has(notebook.path)),
    [filterResult.tree, pinnedNotebooks]
  );
  const pinnedPageEntries = React.useMemo(
    () => pageEntries(availableNotebooks).filter(({ page }) =>
      pinnedPages.has(page.path) && filteredPagePaths.has(page.path)
    ),
    [availableNotebooks, filteredPagePaths, pinnedPages]
  );
  const unpinnedNotebooks = React.useMemo(
    () => filterResult.tree
      .filter((notebook) => !pinnedNotebooks.has(notebook.path))
      .map((notebook) => ({
        ...notebook,
        pages: notebook.pages.filter((page) => !pinnedPages.has(page.path)),
        sections: notebook.sections.map((section) => ({
          ...section,
          pages: section.pages.filter((page) => !pinnedPages.has(page.path)),
        })),
      })),
    [filterResult.tree, pinnedNotebooks, pinnedPages]
  );
  const presentationRows = React.useMemo(
    () => buildNotebookPresentationRows(
      unpinnedNotebooks,
      filterQuery.trim()
        ? notebookGroups.map((group) => ({ ...group, collapsed: false }))
        : notebookGroups
    ),
    [filterQuery, notebookGroups, unpinnedNotebooks]
  );
  const keyNoteEntries = React.useMemo(
    () => collectKeyNoteEntries(filterResult.tree).filter((entry) =>
      !pinnedNotebooks.has(entry.notebookPath) && !pinnedPages.has(entry.page.path)
    ),
    [filterResult.tree, pinnedNotebooks, pinnedPages]
  );
  const keyNotesByNotebook = React.useMemo(() => {
    const grouped = new Map<string, typeof keyNoteEntries>();
    for (const entry of keyNoteEntries) {
      const current = grouped.get(entry.notebookPath) ?? [];
      current.push(entry);
      grouped.set(entry.notebookPath, current);
    }
    return grouped;
  }, [keyNoteEntries]);
  const hasPinnedItems = pinnedNotebookEntries.length > 0 || pinnedPageEntries.length > 0;
  const effectiveUngroupedCollapsed = !filterQuery.trim() && ungroupedCollapsed;
  const allGroupsCollapsed = ungroupedCollapsed && notebookGroups.every((group) => group.collapsed);

  const toggleAllGroups = React.useCallback(() => {
    const collapse = !allGroupsCollapsed;
    setUngroupedCollapsed(collapse);
    for (const group of notebookGroups) {
      if (group.collapsed !== collapse) onToggleNotebookGroup(group.id);
    }
  }, [allGroupsCollapsed, notebookGroups, onToggleNotebookGroup]);

  const chooseNotebook = React.useCallback((path: string) => {
    if (closedNotebooks.has(path)) onOpenNotebook(path);
    onSelectNotebook(path);
    onOpenChange(false);
  }, [closedNotebooks, onOpenChange, onOpenNotebook, onSelectNotebook]);

  const choosePage = React.useCallback((pagePath: string, notebookPath: string) => {
    if (closedNotebooks.has(notebookPath)) onOpenNotebook(notebookPath);
    onSelectNotebook(notebookPath);
    onOpenPage(pagePath);
    onOpenChange(false);
  }, [closedNotebooks, onOpenChange, onOpenNotebook, onOpenPage, onSelectNotebook]);

  const saveGroup = React.useCallback(() => {
    if (!groupDialog) return;
    const name = groupDialog.value.trim();
    if (!name) return;
    if (groupDialog.mode === "rename" && groupDialog.id) {
      onRenameNotebookGroup(groupDialog.id, name);
    } else {
      onCreateNotebookGroup(name);
    }
    setGroupDialog(null);
  }, [groupDialog, onCreateNotebookGroup, onRenameNotebookGroup]);

  const renderNotebookRow = (notebook: VaultNotebook, groupId: string | null) => {
    const isClosed = closedNotebooks.has(notebook.path);

    return (
      <div
        key={notebook.path}
        className="rounded-lg border border-transparent"
        data-testid={`picker-notebook-${notebook.path}`}
        draggable
        onDragStart={(event) => {
          setDraggedNotebookPath(notebook.path);
          event.dataTransfer.effectAllowed = "move";
        }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          if (draggedNotebookPath && draggedNotebookPath !== notebook.path) {
            onReorderNotebooks(draggedNotebookPath, notebook.path);
            onMoveNotebookToGroup(draggedNotebookPath, groupId);
          }
          setDraggedNotebookPath(null);
        }}
        onDragEnd={() => setDraggedNotebookPath(null)}
      >
        <div className="flex min-h-11 items-center gap-1 rounded-lg hover:bg-surface">
          <GripVertical className="ml-1 size-4 shrink-0 cursor-grab text-muted-foreground" aria-label="Drag to reorder notebook" />
          <button
            type="button"
            className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => chooseNotebook(notebook.path)}
          >
            <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: notebook.color }} />
            <span className="min-w-0 flex-1 truncate font-medium">{notebook.name}</span>
            {isClosed ? <span className="text-xs text-muted-foreground">Closed</span> : null}
            {notebook.isPortable ? <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Remote</span> : null}
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`Organize ${notebook.name}`}
            >
              <MoreHorizontal className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onTogglePinnedNotebook(notebook.path)}>
                {pinnedNotebooks.has(notebook.path) ? (
                  <><PinOff className="mr-1 size-4" /> Unpin notebook</>
                ) : (
                  <><Pin className="mr-1 size-4" /> Pin notebook</>
                )}
              </DropdownMenuItem>
              {notebookGroups.map((group) => (
                <DropdownMenuItem key={group.id} onClick={() => onMoveNotebookToGroup(notebook.path, group.id)}>
                  Move to {group.name}
                </DropdownMenuItem>
              ))}
              {notebookGroups.some((group) => group.notebookPaths.includes(notebook.path)) ? (
                <DropdownMenuItem onClick={() => onMoveNotebookToGroup(notebook.path, null)}>Move to Ungrouped</DropdownMenuItem>
              ) : null}
              <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => onArchiveNotebook(notebook.path)}>
                <Archive className="mr-1 size-4" /> Archive notebook
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    );
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="grid max-h-[calc(100dvh-2rem)] grid-rows-[auto_auto_minmax(0,1fr)] gap-3 sm:max-w-2xl"
          data-testid="open-closed-notebooks-dialog"
        >
          <DialogHeader className="pr-10">
            <DialogTitle>Open notebook</DialogTitle>
            <DialogDescription>
              Find, organize, and open notebooks. Groups and archive only change this picker.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                value={filterQuery}
                onChange={(event) => setFilterQuery(event.target.value)}
                placeholder="Filter notebooks and pages"
                aria-label="Filter notebooks and pages by name"
                className="h-11 pl-9 pr-11 text-base sm:text-sm"
                data-testid="notebook-picker-filter"
              />
              {filterQuery ? (
                <button
                  type="button"
                  className="absolute right-0 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => setFilterQuery("")}
                  aria-label="Clear notebook filter"
                >
                  <X className="size-4" />
                </button>
              ) : null}
            </label>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant={keyNotesLens ? "secondary" : "ghost"}
                className="h-11 justify-start gap-2 px-3"
                aria-pressed={keyNotesLens}
                onClick={() => setKeyNotesLens((current) => !current)}
                data-testid="key-notes-lens-toggle"
              >
                <Gem className="size-4 text-accent" /> Key notes
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="h-11 gap-2 px-3"
                aria-label={allGroupsCollapsed ? "Expand all groups" : "Collapse all groups"}
                title={allGroupsCollapsed ? "Expand all groups" : "Collapse all groups"}
                onClick={toggleAllGroups}
                data-testid="toggle-all-notebook-groups"
              >
                {allGroupsCollapsed ? <ChevronDown className="size-4" /> : <ListCollapse className="size-4" />}
                <span className="hidden sm:inline">{allGroupsCollapsed ? "Expand all" : "Collapse all"}</span>
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="h-11 gap-2 px-3"
                onClick={() => setGroupDialog({ mode: "create", value: "" })}
                data-testid="create-notebook-group"
              >
                New group
              </Button>
            </div>
          </div>

          <div className="minimal-scrollbar min-h-0 overflow-y-auto pr-1" data-testid="notebook-picker-content">
            {hasPinnedItems ? (
              <section className="mb-3 rounded-lg border border-border bg-surface/40 p-1" aria-label="Pinned" data-testid="pinned-section">
                <p className="px-2 py-2 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Pinned</p>
                {pinnedNotebookEntries.map((notebook) => (
                  <div key={notebook.path} className="flex min-h-11 items-center rounded-md hover:bg-background">
                    <button type="button" className="flex min-h-11 min-w-0 flex-1 items-center gap-2 px-2 text-left" onClick={() => chooseNotebook(notebook.path)}>
                      <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: notebook.color }} />
                      <span className="min-w-0 flex-1 truncate font-medium">{notebook.name}</span>
                    </button>
                    <button type="button" className="flex size-11 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onTogglePinnedNotebook(notebook.path)} aria-label={`Unpin ${notebook.name}`}>
                      <PinOff className="size-4" />
                    </button>
                  </div>
                ))}
                {pinnedPageEntries.map(({ notebook, page }) => (
                  <PickerPageRow key={page.path} page={page} notebookName={notebook.name} pinned onOpen={() => choosePage(page.path, notebook.path)} onTogglePin={() => onTogglePinnedPage(page.path)} />
                ))}
              </section>
            ) : null}

            {keyNotesLens ? (
              <div className="space-y-2" data-testid="key-notes-lens">
                {Array.from(keyNotesByNotebook.entries()).map(([notebookPath, entries]) => (
                  <section key={notebookPath} className="rounded-lg border border-border/70 p-1">
                    <p className="px-2 py-2 text-sm font-medium text-muted-foreground">{entries[0]?.notebookName}</p>
                    {entries.map((entry) => (
                      <PickerPageRow key={entry.page.path} page={entry.page} pinned={false} onOpen={() => choosePage(entry.page.path, entry.notebookPath)} onTogglePin={() => onTogglePinnedPage(entry.page.path)} />
                    ))}
                  </section>
                ))}
                {keyNoteEntries.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-border px-3 py-8 text-center text-sm text-muted-foreground" data-testid="key-notes-empty">No key notes match this view.</p>
                ) : null}
              </div>
            ) : (
              <div className="space-y-1">
                {presentationRows.map((row) => {
                  if (row.kind === "group") {
                    const group = row.group;
                    const label = group?.name ?? "Ungrouped";
                    const count = group
                      ? unpinnedNotebooks.filter((notebook) => group.notebookPaths.includes(notebook.path)).length
                      : unpinnedNotebooks.filter((notebook) => !notebookGroups.some((candidate) => candidate.notebookPaths.includes(notebook.path))).length;
                    const collapsed = group?.collapsed ?? effectiveUngroupedCollapsed;
                    return (
                      <div
                        key={row.key}
                        className="mt-2 flex min-h-11 items-center rounded-md text-muted-foreground"
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={() => draggedNotebookPath && onMoveNotebookToGroup(draggedNotebookPath, group?.id ?? null)}
                        data-testid={group ? `notebook-group-${group.id}` : "notebook-group-ungrouped"}
                      >
                        <button
                          type="button"
                          className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left text-xs font-medium uppercase tracking-[0.12em] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          onClick={() => group ? onToggleNotebookGroup(group.id) : setUngroupedCollapsed((current) => !current)}
                          aria-expanded={!collapsed}
                          aria-label={`${collapsed ? "Expand" : "Collapse"} ${label}`}
                        >
                          {collapsed ? <ChevronRight className="size-4" /> : <ChevronDown className="size-4" />}
                          <span className="truncate">{label}</span><span>{count}</span>
                        </button>
                        {group ? (
                          <DropdownMenu>
                            <DropdownMenuTrigger className="inline-flex size-11 items-center justify-center rounded-md hover:bg-surface focus-visible:ring-2 focus-visible:ring-ring" aria-label={`Manage ${label}`}>
                              <MoreHorizontal className="size-4" />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => setGroupDialog({ mode: "rename", id: group.id, value: group.name })}>Rename group</DropdownMenuItem>
                              <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => onDeleteNotebookGroup(group.id)}>Delete group</DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        ) : null}
                      </div>
                    );
                  }
                  if (row.group === null && effectiveUngroupedCollapsed) return null;
                  return renderNotebookRow(row.notebook!, row.group?.id ?? null);
                })}
                {filterQuery.trim() && filterResult.tree.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-border px-3 py-8 text-center text-sm text-muted-foreground" data-testid="notebook-filter-empty">No notebooks, sections, or pages match “{filterQuery.trim()}”.</p>
                ) : null}
                {!filterQuery.trim() && availableNotebooks.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-border px-3 py-8 text-center text-sm text-muted-foreground" data-testid="open-closed-notebooks-empty">No notebooks are available.</p>
                ) : null}
              </div>
            )}

            <details className="mt-3 border-t border-border pt-2" data-testid="archived-notebooks-disclosure">
              <summary className="flex min-h-11 cursor-pointer items-center rounded-md px-2 text-sm font-medium hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                Archived <span className="ml-1 text-muted-foreground">({archivedList.length})</span>
              </summary>
              {archivedList.length === 0 ? (
                <p className="px-2 py-3 text-sm text-muted-foreground">No archived notebooks.</p>
              ) : (
                <div className="space-y-1 py-1">
                  {archivedList.map((notebook) => (
                    <div key={notebook.path} className="flex min-h-11 items-center gap-2 rounded-md px-2 hover:bg-surface">
                      <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: notebook.color }} />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{notebook.name}</span>
                      <button type="button" className="min-h-11 rounded-md px-3 text-sm text-accent hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onUnarchiveNotebook(notebook.path)} data-testid={`unarchive-notebook-${notebook.path}`}>
                        Unarchive
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </details>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={groupDialog !== null} onOpenChange={(nextOpen) => !nextOpen && setGroupDialog(null)}>
        <DialogContent className="sm:max-w-sm" data-testid="notebook-group-dialog">
          <DialogHeader>
            <DialogTitle>{groupDialog?.mode === "rename" ? "Rename group" : "New group"}</DialogTitle>
            <DialogDescription>Groups organize the notebook picker only. Notebook folders stay where they are.</DialogDescription>
          </DialogHeader>
          <Input
            value={groupDialog?.value ?? ""}
            onChange={(event) => setGroupDialog((current) => current ? { ...current, value: event.target.value } : current)}
            placeholder="Group name"
            aria-label="Group name"
            className="h-11 text-base"
            autoFocus
            onKeyDown={(event) => event.key === "Enter" && saveGroup()}
          />
          <DialogFooter>
            <Button variant="outline" className="h-11" onClick={() => setGroupDialog(null)}>Cancel</Button>
            <Button className="h-11" disabled={!groupDialog?.value.trim()} onClick={saveGroup}>{groupDialog?.mode === "rename" ? "Save" : "Create group"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
