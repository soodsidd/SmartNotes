import path from "node:path";

/** Vault text page file extension (YAML frontmatter + HTML body). */
export const PAGE_FILE_EXTENSION = ".html";

/** Legacy extension removed by one-shot migration. */
export const LEGACY_PAGE_FILE_EXTENSION = ".md";

export function pageStemFromPath(pagePath: string) {
  const base = path.posix.basename(pagePath);
  if (base.toLowerCase().endsWith(PAGE_FILE_EXTENSION)) {
    return base.slice(0, -PAGE_FILE_EXTENSION.length);
  }
  if (base.toLowerCase().endsWith(LEGACY_PAGE_FILE_EXTENSION)) {
    return base.slice(0, -LEGACY_PAGE_FILE_EXTENSION.length);
  }
  return base;
}

export function isPageFileName(fileName: string) {
  const lower = fileName.toLowerCase();
  return lower.endsWith(PAGE_FILE_EXTENSION);
}

export function inkSidecarRelativePath(pagePath: string) {
  return pagePath.replace(/\.html$/i, ".ink.json");
}

export function annotationsSidecarRelativePath(pagePath: string) {
  return pagePath.replace(/\.html$/i, ".annotations.json");
}

/**
 * Vault-relative path to a Jupyter note's working-directory folder.
 * Sibling to the .html page stub, mirroring the `.assets` convention:
 *   Notebook/Section/Page.html
 *   Notebook/Section/Page.jupyter/          <- notebook working directory
 *   Notebook/Section/Page.jupyter/notebook.ipynb
 */
export function jupyterDirRelativePath(pagePath: string) {
  return pagePath.replace(/\.html$/i, ".jupyter");
}

/** Fixed notebook file name stored inside a Jupyter note's working directory. */
export const JUPYTER_NOTEBOOK_FILE_NAME = "notebook.ipynb";

export function referenceSidecarRelativePath(pagePath: string) {
  return pagePath.replace(/\.html$/i, ".ref.json");
}

/**
 * Vault-relative path to a log note's schema+rows sidecar. Sibling to the
 * `.html` stub, mirroring the other sidecar conventions:
 *   Notebook/Section/Page.html
 *   Notebook/Section/Page.log.json   <- typed schema + row records
 */
export function logSidecarRelativePath(pagePath: string) {
  return pagePath.replace(/\.html$/i, ".log.json");
}

/**
 * Vault-relative path to a linked-design metadata sidecar (SN-168).
 * Sibling to the ordinary `.html` ground-truth file — Smart Notes never
 * injects frontmatter into that HTML:
 *   Notebook/Section/Artifact.html
 *   Notebook/Section/Artifact.design-link.json
 */
export function designLinkSidecarRelativePath(pagePath: string) {
  return pagePath.replace(/\.html$/i, ".design-link.json");
}

export function appendHtmlBlock(body: string, htmlFragment: string) {
  const trimmed = body.trim();
  if (!trimmed) {
    return htmlFragment;
  }
  return `${trimmed}\n${htmlFragment}`;
}

export function prependHtmlBlock(body: string, htmlFragment: string) {
  const trimmed = body.trim();
  if (!trimmed) {
    return htmlFragment;
  }
  return `${htmlFragment}\n${trimmed}`;
}
