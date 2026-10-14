"use client";

import * as React from "react";
import type { Editor } from "@tiptap/react";
import { cn } from "@/lib/utils";
import type { PageComment } from "@/lib/comment-types";
import { buildEditorContextMenuActions, type EditorContextMenuAction } from "@/lib/editor-context-menu";

// ─── Context menu ─────────────────────────────────────────────────────────────

export interface EditorContextMenuProps {
  x: number;
  y: number;
  editor: Editor;
  mobile?: boolean;
  canAddComment: boolean;
  canCopy: boolean;
  canPaste: boolean;
  canPromotePdf?: boolean;
  onAddComment: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onSelectAll: () => void;
  onOpenLink: () => void;
  onPromotePdf?: () => void;
  /** SN-308: when set (right-click inside a table), these groups replace the text-editing groups. */
  tableGroups?: EditorContextMenuAction[][] | null;
  onClose: () => void;
}

const CONTEXT_MENU_GROUPS = [
  ["copy", "paste", "selectAll"],
  ["bold", "italic", "strike", "code"],
  ["h1", "h2", "h3"],
  ["bullet", "ordered", "task"],
  ["link"],
  ["comment"],
  ["promotePdf"],
] as const;

const MOBILE_CONTEXT_MENU_GROUPS = [
  ["copy", "paste", "selectAll"],
  ["comment"],
  ["promotePdf"],
] as const;

export function EditorContextMenu({
  x,
  y,
  editor,
  mobile,
  canAddComment,
  canCopy,
  canPaste,
  canPromotePdf,
  onAddComment,
  onCopy,
  onPaste,
  onSelectAll,
  onOpenLink,
  onPromotePdf,
  tableGroups,
  onClose,
}: EditorContextMenuProps) {
  const menuRef = React.useRef<HTMLDivElement>(null);
  const [position, setPosition] = React.useState({ left: x, top: y });
  const actions = React.useMemo(
    () =>
      buildEditorContextMenuActions(editor, {
        canAddComment,
        canCopy,
        canPaste,
        canPromotePdf,
        onAddComment,
        onCopy,
        onPaste,
        onSelectAll,
        onOpenLink,
        onPromotePdf,
      }),
    [canAddComment, canCopy, canPaste, canPromotePdf, editor, onAddComment, onCopy, onPaste, onSelectAll, onOpenLink, onPromotePdf]
  );
  const actionMap = React.useMemo(
    () => new Map(actions.map((action) => [action.id, action])),
    [actions]
  );
  const renderedGroups: EditorContextMenuAction[][] = React.useMemo(() => {
    if (tableGroups && tableGroups.length > 0) return tableGroups;
    const ids = mobile ? MOBILE_CONTEXT_MENU_GROUPS : CONTEXT_MENU_GROUPS;
    return ids
      .map((group) => group.map((id) => actionMap.get(id)).filter((a): a is EditorContextMenuAction => Boolean(a)))
      .filter((group) => group.length > 0);
  }, [actionMap, mobile, tableGroups]);

  // Keep the whole menu on screen (long table menus, right-clicks near an edge).
  React.useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const margin = 8;
    const rect = menu.getBoundingClientRect();
    const left = Math.max(margin, Math.min(x, window.innerWidth - rect.width - margin));
    const fitsBelow = y + rect.height + margin <= window.innerHeight;
    const top = fitsBelow ? y : Math.max(margin, Math.min(y - rect.height, window.innerHeight - rect.height - margin));
    setPosition((prev) => (prev.left === left && prev.top === top ? prev : { left, top }));
  }, [x, y, renderedGroups]);

  React.useEffect(() => {
    function handlePointerDown(e: PointerEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      role="menu"
      className="comment-context-menu editor-context-menu"
      style={{ left: position.left, top: position.top }}
      data-testid="editor-context-menu"
      data-menu-kind={tableGroups && tableGroups.length > 0 ? "table" : "text"}
    >
      {renderedGroups.map((group, groupIndex) => (
        <React.Fragment key={group.map((action) => action.id).join("-")}>
          {groupIndex > 0 ? <div className="comment-context-separator" role="separator" /> : null}
          {group.map((action) => {
            return (
              <button
                key={action.id}
                role="menuitem"
                type="button"
                className={cn(
                  "comment-context-item",
                  action.active && "comment-context-item--active",
                  action.disabled && "comment-context-item--disabled",
                  action.destructive && "comment-context-item--destructive"
                )}
                onClick={() => {
                  if (action.disabled) return;
                  action.run();
                  onClose();
                }}
                aria-disabled={action.disabled}
                data-testid={action.testId}
              >
                {action.label}
                {action.hint ? <span className="comment-context-hint">{action.hint}</span> : null}
              </button>
            );
          })}
        </React.Fragment>
      ))}
    </div>
  );
}

/** @deprecated Use EditorContextMenu — kept for test imports during transition. */
export const CommentContextMenu = EditorContextMenu;
export type CommentContextMenuProps = EditorContextMenuProps;

// ─── Inline composer ──────────────────────────────────────────────────────────

export interface CommentComposerProps {
  anchorRect: DOMRect;
  onSubmit: (text: string) => void;
  onCancel: () => void;
}

export function CommentComposer({ anchorRect, onSubmit, onCancel }: CommentComposerProps) {
  const [text, setText] = React.useState("");
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const dialogRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  React.useEffect(() => {
    function handlePointerDown(e: PointerEvent) {
      if (dialogRef.current && !dialogRef.current.contains(e.target as Node)) {
        onCancel();
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onCancel]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      onCancel();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      if (text.trim()) onSubmit(text.trim());
    }
  }

  const dialogWidth = 288;
  const left = Math.min(Math.max(8, anchorRect.left), window.innerWidth - dialogWidth - 8);
  const belowTop = anchorRect.bottom + 8;
  const aboveTop = anchorRect.top - 8;
  const estimatedHeight = 132;
  const top =
    belowTop + estimatedHeight <= window.innerHeight
      ? belowTop
      : Math.max(8, aboveTop - estimatedHeight);

  return (
    <div
      ref={dialogRef}
      className="comment-composer comment-composer--floating"
      style={{ top, left, width: dialogWidth }}
      data-testid="comment-composer"
    >
      <textarea
        ref={textareaRef}
        className="comment-composer-textarea"
        placeholder="Add a comment… (Ctrl+Enter to save)"
        rows={2}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        data-testid="comment-composer-textarea"
      />
      <div className="comment-composer-actions">
        <button
          type="button"
          className="link-dialog-apply"
          disabled={!text.trim()}
          onClick={() => text.trim() && onSubmit(text.trim())}
          data-testid="comment-composer-submit"
        >
          Add
        </button>
        <button
          type="button"
          className="link-dialog-cancel"
          onClick={onCancel}
          data-testid="comment-composer-cancel"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─── Hover popover ────────────────────────────────────────────────────────────

export interface CommentPopoverProps {
  comment: PageComment;
  anchorRect: DOMRect;
  onResolve: (id: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

export const CommentPopover = React.forwardRef<HTMLDivElement, CommentPopoverProps>(
  function CommentPopover(
    { comment, anchorRect, onResolve, onDelete, onClose, onMouseEnter, onMouseLeave },
    ref
  ) {
    React.useEffect(() => {
      function handleKeyDown(e: KeyboardEvent) {
        if (e.key === "Escape") onClose();
      }
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }, [onClose]);

    // Position fixed below the anchor span, clamped to viewport width.
    const left = Math.min(anchorRect.left, window.innerWidth - 296);
    const top = anchorRect.bottom + 6;

    return (
      <div
        ref={ref}
        className="comment-popover"
        style={{ top, left }}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        data-testid="comment-popover"
      >
        <p className="comment-popover-text">{comment.text}</p>
        <div className="comment-popover-actions">
          <button
            type="button"
            className="comment-popover-btn"
            onClick={() => { onResolve(comment.id); onClose(); }}
            data-testid="comment-resolve"
          >
            Resolve
          </button>
          <button
            type="button"
            className="comment-popover-btn comment-popover-btn--destructive"
            onClick={() => { onDelete(comment.id); onClose(); }}
            data-testid="comment-delete"
          >
            Delete
          </button>
        </div>
      </div>
    );
  }
);
