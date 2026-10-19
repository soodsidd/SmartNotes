"use client";

import * as React from "react";

export function PageTitleBar({
  pagePath,
  title,
  createdAt,
  readOnly = false,
  focusOnCreate = false,
  onCommit,
}: {
  pagePath: string | null;
  title: string;
  createdAt?: string | null;
  readOnly?: boolean;
  focusOnCreate?: boolean;
  onCommit?: (title: string) => void;
}) {
  const [value, setValue] = React.useState(title);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const cancelCommitRef = React.useRef(false);
  React.useEffect(() => setValue(title), [pagePath, title]);
  React.useEffect(() => {
    if (focusOnCreate && !readOnly) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [focusOnCreate, pagePath, readOnly]);

  const date = createdAt ? new Date(createdAt) : null;
  const hasDate = date && !Number.isNaN(date.getTime());

  return (
    <div className="page-title-bar" data-testid="page-title-bar">
      <input
        ref={inputRef}
        className="page-title-bar__input"
        aria-label="Page title"
        data-testid="page-title-input"
        value={value}
        readOnly={readOnly || !onCommit}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => {
          if (cancelCommitRef.current) { cancelCommitRef.current = false; return; }
          if (!readOnly && onCommit) onCommit(value.trim() || title);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); }
          if (event.key === "Escape") { cancelCommitRef.current = true; setValue(title); onCommit?.(title); event.currentTarget.blur(); }
        }}
      />
      <div className="page-title-bar__rule" />
      {hasDate ? (
        <div className="page-title-bar__metadata" data-testid="page-title-metadata">
          <time dateTime={createdAt ?? undefined}>{new Intl.DateTimeFormat(undefined, { dateStyle: "long" }).format(date)}</time>
          <time dateTime={createdAt ?? undefined}>{new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(date)}</time>
        </div>
      ) : null}
    </div>
  );
}
