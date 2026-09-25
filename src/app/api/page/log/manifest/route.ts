import { NextResponse } from "next/server";
import { readPage } from "@/server/vault/pages";
import { toErrorResponse, VaultError } from "@/server/vault/errors";

/**
 * Per-page installable manifest (SN-144).
 *
 * Returns a Web App Manifest whose `start_url` is pinned to a single log page's
 * focused shell (`/log?path=…`). Installing from a log page therefore adds a
 * dedicated home-screen icon that launches straight into that log — not the
 * vault root. Each page gets a distinct `id` so phones treat them as separate
 * installable mini-apps.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const path = url.searchParams.get("path");
    if (!path) {
      throw new VaultError("INVALID_PATH", "A log page \"path\" is required.");
    }

    const page = await readPage(path);
    if (page.metadata.note_type !== "log") {
      throw new VaultError("NOT_A_LOG_PAGE", "This page is not a log page.", 400);
    }

    const encodedPath = encodeURIComponent(page.path);
    const startUrl = `/log?path=${encodedPath}&source=pwa`;
    const title = page.title || "Log";
    const shortName = title.length > 12 ? `${title.slice(0, 11)}…` : title;

    const manifest = {
      name: `${title} — Log`,
      short_name: shortName,
      description: `Quick log entry for “${title}”`,
      // Distinct id per page so each installed shortcut is its own mini-app.
      id: `/log?path=${encodedPath}`,
      start_url: startUrl,
      scope: "/log",
      display: "standalone",
      background_color: "#0b0d10",
      theme_color: "#0b0d10",
      icons: [
        { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
        { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
        { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
        { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
    };

    return new NextResponse(JSON.stringify(manifest, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/manifest+json",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
