export interface PageComment {
  id: string;
  /** Verbatim selected text — used as the text-range anchor. */
  quote: string;
  /** Comment body. */
  text: string;
  createdAt: string;    // ISO-8601
  resolvedAt: string | null;
  /**
   * SN-310: optional design-page anchor. `path` is the element-child index path
   * from `<body>` (same addressing as design Preview edits); `tag` is the
   * lowercase tag name for a human/companion-readable label. Text pages omit it.
   */
  target?: PageCommentTarget;
}

export interface PageCommentTarget {
  kind: "design-element";
  path: number[];
  tag: string;
}

/** Max chars of element text kept as a design comment's `quote`. */
export const DESIGN_COMMENT_QUOTE_LIMIT = 280;

export function generateCommentId(): string {
  return `cmt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
