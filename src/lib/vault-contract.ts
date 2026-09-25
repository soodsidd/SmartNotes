/** Kind of a vault page. Keep in sync with `src/server/vault/types.ts`. */
export type NoteType = "text" | "ink" | "jupyter" | "log" | "design" | "app" | "spreadsheet";

export interface VaultPage {
  id: string;
  path: string;
  title: string;
  slug: string;
  createdAt: string | null;
  updatedAt: string | null;
  preview: string;
  content: string;
  hasFrontmatterError?: boolean;
  parentId: string | null;
  noteType: NoteType;
  /** SN-229: key-note marker shown as a gem beside the tree title. */
  keyNote?: boolean;
  metadata?: Record<string, unknown>;
  /** SN-168: body is a linked ordinary HTML file (no vault frontmatter). */
  designLinked?: boolean;
  /** SN-168: link metadata exists but the HTML ground-truth file is missing. */
  sourceMissing?: boolean;
}

export interface NestPagePayload {
  action: "nest";
  path: string;
  parentId: string | null;
}

export interface KeyNotePagePayload {
  action: "keyNote";
  path: string;
  keyNote: boolean;
}

export interface ReorderPagesPayload {
  sectionPath: string;
  orderedIds: string[];
}

export interface VaultSection {
  id: string;
  path: string;
  name: string;
  pages: VaultPage[];
}

export interface VaultNotebook {
  id: string;
  path: string;
  name: string;
  color: string;
  pages: VaultPage[];
  sections: VaultSection[];
  isPortable?: boolean;
  rootPath?: string;
}

export interface VaultTreeResponse {
  tree: VaultNotebook[];
  root: string;
}

export interface ApiPageDocument extends VaultPage {
  body: string;
  metadata: Record<string, unknown>;
  notebookPath: string;
  notebookName: string;
  sectionPath: string | null;
  sectionName: string | null;
  /** Absolute OS path after portable-notebook resolution (own-in-place). */
  resolvedDiskPath?: string;
  /** SN-168: body is a linked ordinary HTML file (no vault frontmatter). */
  designLinked?: boolean;
  /** SN-168: link metadata exists but the HTML ground-truth file is missing. */
  sourceMissing?: boolean;
}

export interface SavePagePayload {
  path: string;
  title: string;
  content: string;
  originSocketId?: string;
  originClientId?: string;
}

export interface CreatePagePayload {
  sectionPath?: string | null;
  notebookPath?: string | null;
  title?: string;
  noteType?: NoteType;
  parentId?: string | null;
}

export interface RenamePagePayload {
  action?: "rename";
  path: string;
  title: string;
}

export interface MovePagePayload {
  action: "move";
  path: string;
  sectionPath: string;
}

export interface CreateNotebookPayload {
  name?: string;
}

export interface RenameNotebookPayload {
  path: string;
  name: string;
}

export interface CreateSectionPayload {
  notebookPath: string;
  name?: string;
}

export interface RenameSectionPayload {
  path: string;
  name: string;
}

export interface CapturePayload {
  destination: "inbox" | "page";
  content: string;
  title?: string;
  notebookPath?: string;
  sectionPath?: string;
}

export interface NotebookMutationResult {
  path: string;
  name: string;
  previousPath?: string;
  inboxSectionPath?: string;
}

export interface SectionMutationResult {
  path: string;
  name: string;
  notebookPath: string;
  previousPath?: string;
}

export const NOTEBOOK_COLORS = [
  "var(--notebook-color-1)",
  "var(--notebook-color-2)",
  "var(--notebook-color-3)",
  "var(--notebook-color-4)",
  "var(--notebook-color-5)",
  "var(--notebook-color-6)",
] as const;
