"use client";

import * as React from "react";
import { FileText, SearchIcon } from "lucide-react";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import type { SearchHighlightRange, SearchResult } from "@/lib/search";

type FallbackState = "idle" | "loading" | "ready" | "error";

function clampRanges(ranges: SearchHighlightRange[], textLength: number) {
  return ranges
    .map((range) => ({
      start: Math.max(0, Math.min(textLength, range.start)),
      end: Math.max(0, Math.min(textLength, range.end)),
    }))
    .filter((range) => range.end > range.start)
    .sort((left, right) => left.start - right.start);
}

function buildFallbackHighlights(text: string, query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return [] as SearchHighlightRange[];
  }

  const matchStart = text.toLowerCase().indexOf(normalizedQuery);
  if (matchStart === -1) {
    return [] as SearchHighlightRange[];
  }

  return [{ start: matchStart, end: matchStart + normalizedQuery.length }];
}

function HighlightedText({
  text,
  ranges,
}: {
  text: string;
  ranges: SearchHighlightRange[];
}) {
  const normalizedRanges = clampRanges(ranges, text.length);
  if (!normalizedRanges.length) {
    return <>{text}</>;
  }

  const segments: React.ReactNode[] = [];
  let cursor = 0;

  normalizedRanges.forEach((range, index) => {
    if (range.start > cursor) {
      segments.push(
        <React.Fragment key={`text-${index}-${cursor}`}>
          {text.slice(cursor, range.start)}
        </React.Fragment>
      );
    }

    segments.push(
      <mark
        key={`mark-${index}-${range.start}`}
        className="rounded bg-accent/15 px-0.5 text-foreground"
      >
        {text.slice(range.start, range.end)}
      </mark>
    );
    cursor = range.end;
  });

  if (cursor < text.length) {
    segments.push(<React.Fragment key={`tail-${cursor}`}>{text.slice(cursor)}</React.Fragment>);
  }

  return <>{segments}</>;
}

export function SearchModal({
  open,
  query,
  results,
  isServerFallback,
  fallbackState,
  onOpenChange,
  onQueryChange,
  onSelectResult,
}: {
  open: boolean;
  query: string;
  results: SearchResult[];
  isServerFallback: boolean;
  fallbackState: FallbackState;
  onOpenChange: (open: boolean) => void;
  onQueryChange: (value: string) => void;
  onSelectResult: (result: SearchResult) => void;
}) {
  const trimmedQuery = query.trim();
  const hasQuery = trimmedQuery.length > 0;
  const groupHeading = hasQuery
    ? isServerFallback
      ? "Full vault matches"
      : "Matches"
    : "Recent notes";

  const emptyMessage = !hasQuery
    ? "No notes in this vault yet."
    : fallbackState === "loading"
      ? "Searching the full vault..."
      : fallbackState === "error"
        ? "No in-memory matches, and the full-vault search request failed."
        : "No notes matched that search.";

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Search notes"
      description="Find notes across the vault by title and note body."
      className="left-0 top-0 h-dvh max-w-none -translate-x-0 translate-y-0 rounded-none border-0 p-0 xl:left-1/2 xl:top-[12vh] xl:h-auto xl:w-full xl:max-w-4xl xl:-translate-x-1/2 xl:rounded-xl"
      showCloseButton
    >
      <Command shouldFilter={false} loop className="h-full xl:max-h-[min(78vh,720px)]">
        <div className="border-b border-border/80 bg-background/95 px-1 pb-1 pt-1">
          <CommandInput
            autoFocus
            value={query}
            onValueChange={onQueryChange}
            placeholder="Search titles and note text..."
          />
          <div className="flex items-center justify-between px-3 pb-2 pt-2 text-[11px] text-muted-foreground">
            <span>
              {hasQuery
                ? isServerFallback
                  ? "Client search found no matches. Showing server full-body results."
                  : "Fuzzy search is running against the loaded vault tree."
                : "Recent notes are sorted by last update time."}
            </span>
            <span className="hidden xl:inline">Esc to close</span>
          </div>
        </div>

        <CommandList className="max-h-none flex-1 px-2 pb-2">
          <CommandEmpty>{emptyMessage}</CommandEmpty>
          {results.length > 0 ? (
            <CommandGroup heading={groupHeading} className="space-y-2">
              {results.map((result) => {
                const titleHighlights = result.titleHighlights ?? buildFallbackHighlights(result.title, trimmedQuery);
                const excerptHighlights =
                  result.excerptHighlights ?? buildFallbackHighlights(result.excerpt, trimmedQuery);

                return (
                  <CommandItem
                    key={result.path}
                    value={`${result.title} ${result.path} ${result.breadcrumb}`}
                    keywords={[result.excerpt, result.breadcrumb]}
                    onSelect={() => onSelectResult(result)}
                    className={cn(
                      "items-start gap-3 rounded-xl border border-border/60 bg-background/60 px-3 py-3 text-left transition",
                      "data-[selected=true]:border-accent/30 data-[selected=true]:bg-accent/6"
                    )}
                  >
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-surface">
                      <FileText className="size-4 text-accent" />
                    </div>
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex items-start justify-between gap-3">
                        <p className="truncate font-medium text-foreground">
                          <HighlightedText text={result.title} ranges={titleHighlights} />
                        </p>
                        {result.source ? (
                          <span className="shrink-0 rounded-full border border-border/60 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                            {result.source}
                          </span>
                        ) : null}
                      </div>
                      <p className="truncate text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                        {result.breadcrumb}
                      </p>
                      <p className="line-clamp-2 text-sm leading-6 text-muted-foreground">
                        {result.excerpt ? (
                          <HighlightedText text={result.excerpt} ranges={excerptHighlights} />
                        ) : (
                          "No body text available."
                        )}
                      </p>
                    </div>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          ) : hasQuery && fallbackState === "loading" ? (
            <div className="flex items-center justify-center gap-2 px-4 py-6 text-sm text-muted-foreground">
              <SearchIcon className="size-4 animate-pulse" />
              Searching the full vault...
            </div>
          ) : null}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
