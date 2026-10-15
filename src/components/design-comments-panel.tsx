"use client";

import * as React from "react";
import { MessageSquarePlus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PageComment } from "@/lib/comment-types";

/**
 * SN-310: where a new design comment points. `path` is the element-child index
 * path from the frame `<body>`; `null` means a page-level comment.
 */
export interface DesignCommentAnchor {
  path: number[] | null;
  tag: string;
  quote: string;
}

export interface DesignCommentsPanelProps {
  comments: PageComment[];
  /** Comment to scroll to and highlight (from a pin click or a fresh add). */
  focusedId: string | null;
  onFocusHandled: () => void;
  /** Persist the full next comments array. */
  onChange: (next: PageComment[]) => void;
  /** Open the composer for a page-level comment, anchored at the button. */
  onAddPageComment: (anchorRect: DOMRect) => void;
  onClose: () => void;
}

const actionClass =
  "rounded px-1.5 py-0.5 text-xs font-medium text-muted-foreground transition hover:bg-surface hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-sm:min-h-11 max-sm:px-3";

/**
 * Page-level list of companion comments on a design page. Comments live in the
 * same `comments` array as text-page comments, so companion `page_get` reads
 * them unchanged; element anchors are shown as numbered pins in Preview.
 */
export function DesignCommentsPanel({
  comments,
  focusedId,
  onFocusHandled,
  onChange,
  onAddPageComment,
  onClose,
}: DesignCommentsPanelProps) {
  const [showResolved, setShowResolved] = React.useState(false);
  const [editing, setEditing] = React.useState<{ id: string; text: string } | null>(null);
  const listRef = React.useRef<HTMLOListElement | null>(null);
  const active = comments.filter((comment) => !comment.resolvedAt);
  const resolved = comments.filter((comment) => comment.resolvedAt);

  React.useEffect(() => {
    if (!focusedId) return;
    const item = listRef.current?.querySelector<HTMLElement>(`[data-comment-id="${focusedId.replace(/["\\]/g, "")}"]`);
    item?.scrollIntoView?.({ block: "nearest" });
    const timer = window.setTimeout(onFocusHandled, 1600);
    return () => window.clearTimeout(timer);
  }, [focusedId, onFocusHandled]);

  const update = (id: string, patch: Partial<PageComment>) =>
    onChange(comments.map((comment) => (comment.id === id ? { ...comment, ...patch } : comment)));

  const saveEdit = () => {
    if (!editing?.text.trim()) return;
    update(editing.id, { text: editing.text.trim() });
    setEditing(null);
  };

  const renderItem = (comment: PageComment, number: number | null) => {
    const isEditing = editing?.id === comment.id;
    return (
      <li
        key={comment.id}
        data-comment-id={comment.id}
        data-testid="design-comment-item"
        className={cn(
          "rounded-md border border-border bg-background p-2.5 transition",
          comment.id === focusedId && "ring-2 ring-accent",
          comment.resolvedAt && "opacity-70"
        )}
      >
        <div className="mb-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          {number !== null ? (
            <span className="flex size-4 items-center justify-center rounded-full bg-accent text-[10px] font-semibold text-accent-foreground">
              {number}
            </span>
          ) : null}
          <span className="font-mono">{comment.target ? `<${comment.target.tag}>` : "Page"}</span>
          {comment.resolvedAt ? <span>· Resolved</span> : null}
        </div>
        {comment.quote ? (
          <p className="mb-1.5 line-clamp-2 border-l-2 border-border pl-2 text-xs text-muted-foreground">{comment.quote}</p>
        ) : null}
        {isEditing ? (
          <div className="flex flex-col gap-1.5">
            <textarea
              aria-label="Edit comment"
              data-testid="design-comment-edit-textarea"
              className="comment-composer-textarea"
              rows={3}
              autoFocus
              value={editing.text}
              onChange={(event) => setEditing({ id: comment.id, text: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.stopPropagation();
                  setEditing(null);
                }
                if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                  event.preventDefault();
                  saveEdit();
                }
              }}
            />
            <div className="flex gap-1">
              <button type="button" className="link-dialog-apply" disabled={!editing.text.trim()} onClick={saveEdit} data-testid="design-comment-edit-save">
                Save
              </button>
              <button type="button" className="link-dialog-cancel" onClick={() => setEditing(null)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <p className="whitespace-pre-wrap break-words text-sm text-foreground">{comment.text}</p>
        )}
        {!isEditing ? (
          <div className="mt-1.5 flex flex-wrap gap-1">
            <button type="button" className={actionClass} onClick={() => setEditing({ id: comment.id, text: comment.text })} data-testid="design-comment-edit">
              Edit
            </button>
            {comment.resolvedAt ? (
              <button type="button" className={actionClass} onClick={() => update(comment.id, { resolvedAt: null })} data-testid="design-comment-reopen">
                Reopen
              </button>
            ) : (
              <button type="button" className={actionClass} onClick={() => update(comment.id, { resolvedAt: new Date().toISOString() })} data-testid="design-comment-resolve">
                Resolve
              </button>
            )}
            <button
              type="button"
              className={cn(actionClass, "text-destructive hover:bg-destructive/10 hover:text-destructive")}
              onClick={() => onChange(comments.filter((entry) => entry.id !== comment.id))}
              data-testid="design-comment-delete"
            >
              Delete
            </button>
          </div>
        ) : null}
      </li>
    );
  };

  return (
    <aside
      aria-label="Design comments"
      data-testid="design-comments-panel"
      className="flex w-72 shrink-0 flex-col border-l border-border bg-surface/40 max-sm:absolute max-sm:inset-x-0 max-sm:bottom-0 max-sm:z-30 max-sm:max-h-[60%] max-sm:w-auto max-sm:rounded-t-lg max-sm:border-l-0 max-sm:border-t max-sm:bg-background max-sm:shadow-lg"
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <h2 className="flex-1 text-xs font-semibold text-foreground">Comments for companion</h2>
        <button
          type="button"
          aria-label="Close comments"
          onClick={onClose}
          className="flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-surface hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-sm:size-11"
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <button
          type="button"
          data-testid="design-add-page-comment"
          onClick={(event) => onAddPageComment(event.currentTarget.getBoundingClientRect())}
          className="mb-3 flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-border px-2 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-surface hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-sm:min-h-11"
        >
          <MessageSquarePlus className="size-3.5" />
          Add page comment
        </button>
        {active.length === 0 ? (
          <p className="mb-3 text-xs text-muted-foreground" data-testid="design-comments-empty">
            No open comments. Right-click (or long-press) an element in Preview and choose Add comment.
          </p>
        ) : null}
        <ol ref={listRef} className="flex flex-col gap-2">
          {active.map((comment, index) => renderItem(comment, comment.target ? index + 1 : null))}
          {showResolved ? resolved.map((comment) => renderItem(comment, null)) : null}
        </ol>
        {resolved.length > 0 ? (
          <button type="button" className={cn(actionClass, "mt-3")} onClick={() => setShowResolved((value) => !value)} data-testid="design-comments-show-resolved">
            {showResolved ? "Hide resolved" : `Show resolved (${resolved.length})`}
          </button>
        ) : null}
      </div>
    </aside>
  );
}
