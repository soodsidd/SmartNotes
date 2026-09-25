export type FrontmatterValue =
  | string
  | number
  | boolean
  | null
  | FrontmatterValue[]
  | { [key: string]: FrontmatterValue };

export type FrontmatterData = Record<string, FrontmatterValue>;

/**
 * Kind of a vault page.
 * - `text`    — rich-text HTML page (default)
 * - `ink`     — Tldraw ink canvas (sidecar scene)
 * - `jupyter` — embedded JupyterLab notebook (sibling `.jupyter/` working dir)
 * - `log`     — form-backed log: typed schema + rows in a `.log.json` sidecar
 * - `design`  — self-contained HTML/CSS UI artifact rendered RAW (bypasses the
 *               Tiptap pipeline) so real CSS applies faithfully (SN-167). May be
 *               an owned vault page or a linked in-place HTML file (SN-168).
 * - `app`     — companion-authored HTML/CSS/JS hosted in an opaque sandbox with
 *               explicitly attached JSON tables (SN-182).
 * - `spreadsheet` — Syncfusion workbook stored in a sibling native JSON sidecar.
 */
export type NoteType = "text" | "ink" | "jupyter" | "log" | "design" | "app" | "spreadsheet";

export interface VaultPageSummary {
  id: string;
  path: string;
  slug: string;
  title: string;
  preview: string;
  /** Full markdown body — included so the UI can hydrate the editor without a separate fetch. */
  content: string;
  createdAt: string | null;
  updatedAt: string | null;
  hasFrontmatterError?: boolean;
  parentId: string | null;
  noteType: NoteType;
  /** SN-229: key-note marker shown as a gem beside the tree title. */
  keyNote: boolean;
  metadata?: FrontmatterData;
  /** SN-168: page body is an ordinary linked HTML file (no vault frontmatter). */
  designLinked?: boolean;
  /** SN-168: link metadata exists but the HTML ground-truth file is missing. */
  sourceMissing?: boolean;
}

export interface VaultSection {
  id: string;
  path: string;
  name: string;
  pages: VaultPageSummary[];
}

export interface VaultNotebook {
  id: string;
  path: string;
  name: string;
  color: string;
  pages: VaultPageSummary[];
  sections: VaultSection[];
  isPortable?: boolean;
  rootPath?: string;
}

export interface VaultTree {
  tree: VaultNotebook[];
  root: string;
}

export interface VaultPageDocument {
  path: string;
  title: string;
  body: string;
  createdAt: string | null;
  updatedAt: string | null;
  metadata: FrontmatterData;
  /** SN-168: page body is an ordinary linked HTML file (no vault frontmatter). */
  designLinked?: boolean;
  /** SN-168: link metadata exists but the HTML ground-truth file is missing. */
  sourceMissing?: boolean;
}
