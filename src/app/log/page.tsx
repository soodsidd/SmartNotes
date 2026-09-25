import * as React from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { FocusedLogShell } from "@/components/focused-log-shell";
import { readPage } from "@/server/vault/pages";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type SearchParams = { [key: string]: string | string[] | undefined };

function firstParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

async function loadLogPage(path: string | null) {
  if (!path) return null;
  try {
    const page = await readPage(path);
    if (page.metadata.note_type !== "log") return null;
    return { path: page.path, title: page.title };
  } catch {
    return null;
  }
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<SearchParams> | SearchParams;
}): Promise<Metadata> {
  const resolved = await searchParams;
  const path = firstParam(resolved.path);
  const page = await loadLogPage(path);
  if (!page) {
    return { title: "Log — Smart Notes" };
  }
  // Pin an installable, per-page manifest so a home-screen shortcut launches
  // straight into this log (start_url = /log?path=…), not the vault root.
  return {
    title: `${page.title} — Log`,
    manifest: `/api/page/log/manifest?path=${encodeURIComponent(page.path)}`,
  };
}

export default async function LogFocusedPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams> | SearchParams;
}) {
  const resolved = await searchParams;
  const path = firstParam(resolved.path);
  const view = firstParam(resolved.view);
  const requestedTab = firstParam(resolved.tab);
  const page = await loadLogPage(path);

  if (!page) {
    return (
      <div className="flex h-[100dvh] w-full flex-col items-center justify-center gap-3 bg-background px-6 text-center">
        <p className="text-sm text-muted-foreground" data-testid="log-focused-missing">
          {path
            ? "This log page could not be found, or it is not a log page."
            : "No log page was specified."}
        </p>
        <Link
          href="/"
          className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground transition hover:bg-surface"
        >
          Back to notebook
        </Link>
      </div>
    );
  }

  const initialTab = view !== null
    ? "history"
    : requestedTab === "history" || requestedTab === "table" || requestedTab === "source"
      ? requestedTab
      : "form";
  return (
    <FocusedLogShell
      pagePath={page.path}
      title={page.title}
      initialTab={initialTab}
      initialViewId={view}
    />
  );
}
