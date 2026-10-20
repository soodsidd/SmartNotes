import type { Density } from "@/components/density-provider";

export const TREE_SIDEBAR_COLLAPSED_KEY = "smart-notes-tree-sidebar-collapsed";
export const TREE_SIDEBAR_WIDTH_KEY = "smart-notes-tree-sidebar-width";
export const TREE_SIDEBAR_DEFAULT_WIDTH = 260;
export const TREE_SIDEBAR_MIN_WIDTH = 200;
export const TREE_SIDEBAR_MAX_WIDTH = 440;

export const NOTEBOOK_RAIL_COLLAPSED_KEY = "smart-notes-notebook-rail-collapsed";
export const NOTEBOOK_RAIL_WIDTH_KEY = "smart-notes-notebook-rail-width";
export const NOTEBOOK_RAIL_DEFAULT_WIDTH = 200;
export const NOTEBOOK_RAIL_MIN_WIDTH = 160;
export const NOTEBOOK_RAIL_MAX_WIDTH = 320;

export function clampNotebookRailWidth(width: number) {
  return Math.min(NOTEBOOK_RAIL_MAX_WIDTH, Math.max(NOTEBOOK_RAIL_MIN_WIDTH, Math.round(width)));
}

export function readNotebookRailWidth() {
  if (typeof window === "undefined") return NOTEBOOK_RAIL_DEFAULT_WIDTH;
  const stored = Number(window.localStorage.getItem(NOTEBOOK_RAIL_WIDTH_KEY));
  if (!Number.isFinite(stored) || stored <= 0) return NOTEBOOK_RAIL_DEFAULT_WIDTH;
  return clampNotebookRailWidth(stored);
}

export function writeNotebookRailWidth(width: number) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(NOTEBOOK_RAIL_WIDTH_KEY, String(clampNotebookRailWidth(width)));
}

export function sidebarWidthFromKey(
  key: string,
  current: number,
  minimum: number,
  maximum: number,
  clamp: (width: number) => number
): number | null {
  if (key === "Home") return minimum;
  if (key === "End") return maximum;
  if (key === "ArrowLeft") return clamp(current - 16);
  if (key === "ArrowRight") return clamp(current + 16);
  return null;
}

export function clampTreeSidebarWidth(width: number) {
  return Math.min(TREE_SIDEBAR_MAX_WIDTH, Math.max(TREE_SIDEBAR_MIN_WIDTH, Math.round(width)));
}

export function readTreeSidebarWidth() {
  if (typeof window === "undefined") return TREE_SIDEBAR_DEFAULT_WIDTH;
  const stored = Number(window.localStorage.getItem(TREE_SIDEBAR_WIDTH_KEY));
  if (!Number.isFinite(stored) || stored <= 0) return TREE_SIDEBAR_DEFAULT_WIDTH;
  return clampTreeSidebarWidth(stored);
}

export function writeTreeSidebarWidth(width: number) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(TREE_SIDEBAR_WIDTH_KEY, String(clampTreeSidebarWidth(width)));
}

export interface KeyboardShortcutRef {
  label: string;
  keys: string;
  macKeys: string;
}

export const COMMENT_SHORTCUT: KeyboardShortcutRef = {
  label: "Add comment",
  keys: "Ctrl+Shift+M",
  macKeys: "⌘⇧M",
};

export const KEYBOARD_SHORTCUTS: KeyboardShortcutRef[] = [
  { label: "Bold", keys: "Ctrl+B", macKeys: "⌘B" },
  { label: "Italic", keys: "Ctrl+I", macKeys: "⌘I" },
  { label: "Strikethrough", keys: "Ctrl+Shift+X", macKeys: "⌘⇧X" },
  { label: "Insert link", keys: "Ctrl+K", macKeys: "⌘K" },
  { label: "Heading 1", keys: "Ctrl+Alt+1", macKeys: "⌘⌥1" },
  { label: "Heading 2", keys: "Ctrl+Alt+2", macKeys: "⌘⌥2" },
  { label: "Heading 3", keys: "Ctrl+Alt+3", macKeys: "⌘⌥3" },
  { label: "Bullet list", keys: "Ctrl+Shift+8", macKeys: "⌘⇧8" },
  { label: "Numbered list", keys: "Ctrl+Shift+7", macKeys: "⌘⇧7" },
  { label: "Blockquote", keys: "Ctrl+Shift+9", macKeys: "⌘⇧9" },
  COMMENT_SHORTCUT,
];

export const DENSITY_OPTIONS: { value: Density; label: string }[] = [
  { value: "compact", label: "Small" },
  { value: "normal", label: "Normal" },
  { value: "comfortable", label: "Large" },
];

export function getVersionsControlLabel(
  pagePath: string,
  ghostVersions: { parentPagePath: string; dismissing?: boolean } | null
) {
  if (ghostVersions?.parentPagePath === pagePath && !ghostVersions.dismissing) {
    return "Hide versions";
  }
  return "View versions";
}

export function readTreeSidebarCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(TREE_SIDEBAR_COLLAPSED_KEY) === "true";
}

export function writeTreeSidebarCollapsed(collapsed: boolean) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(TREE_SIDEBAR_COLLAPSED_KEY, collapsed ? "true" : "false");
}

export function readNotebookRailCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(NOTEBOOK_RAIL_COLLAPSED_KEY) === "true";
}

export function writeNotebookRailCollapsed(collapsed: boolean) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(NOTEBOOK_RAIL_COLLAPSED_KEY, collapsed ? "true" : "false");
}

export const MOBILE_PANE_MODE_KEY = "smart-notes-mobile-pane-mode";

export function readMobilePaneMode(): "rail" | "page-tree" {
  if (typeof window === "undefined") return "page-tree";
  const stored = window.localStorage.getItem(MOBILE_PANE_MODE_KEY);
  return stored === "rail" ? "rail" : "page-tree";
}

export function writeMobilePaneMode(mode: "rail" | "page-tree") {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(MOBILE_PANE_MODE_KEY, mode);
}
