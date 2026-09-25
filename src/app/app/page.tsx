import * as React from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { FocusedAppShell } from "@/components/focused-app-shell";
import { appManifestUrl } from "@/lib/api/app";
import { readPage } from "@/server/vault/pages";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type SearchParams = { [key: string]: string | string[] | undefined };

function firstParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

async function loadAppPage(path: string | null) {
  if (!path) return null;
  try {
    const page = await readPage(path);
    if (page.metadata.note_type !== "app") return null;
    return { path: page.path, title: page.title, body: page.body };
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
  const page = await loadAppPage(path);
  if (!page) {
    return { title: "App — Smart Notes" };
  }
  // Pin an installable, per-page manifest so a home-screen shortcut launches
  // straight into this App (start_url = /app?path=…), not the vault root.
  return {
    title: `${page.title} — App`,
    manifest: appManifestUrl(page.path),
  };
}

export default async function AppFocusedPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams> | SearchParams;
}) {
  const resolved = await searchParams;
  const path = firstParam(resolved.path);
  const page = await loadAppPage(path);

  if (!page) {
    return (
      <div className="flex h-[100dvh] w-full flex-col items-center justify-center gap-3 bg-background px-6 text-center">
        <p className="text-sm text-muted-foreground" data-testid="app-focused-missing">
          {path
            ? "This app page could not be found, or it is not an App page."
            : "No app page was specified."}
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

  return <FocusedAppShell pagePath={page.path} title={page.title} bodyHtml={page.body} />;
}
