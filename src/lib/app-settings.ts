import type { Density } from "@/components/density-provider";

export const TREE_SIDEBAR_COLLAPSED_KEY = "smart-notes-tree-sidebar-collapsed";
export const TREE_SIDEBAR_WIDTH_KEY = "smart-notes-tree-sidebar-width";
export const TREE_SIDEBAR_DEFAULT_WIDTH = 280;
export const TREE_SIDEBAR_MIN_WIDTH = 220;
export const TREE_SIDEBAR_MAX_WIDTH = 480;

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
