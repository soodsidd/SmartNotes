export interface PageComment {
  id: string;
  /** Verbatim selected text — used as the text-range anchor. */
  quote: string;
  /** Comment body. */
  text: string;
  createdAt: string;    // ISO-8601
  resolvedAt: string | null;
}

export function generateCommentId(): string {
  return `cmt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
