import { NextResponse } from "next/server";
import { readPage } from "@/server/vault/pages";
import { toErrorResponse, VaultError } from "@/server/vault/errors";

/**
 * Per-page installable manifest for App pages (SN-187).
 *
 * Mirrors the log manifest contract (SN-144) but targets the App focused shell.
 * Returns a Web App Manifest whose `start_url` is pinned to a single App page's
 * focused shell (`/app?path=…`). Installing from an App page therefore adds a
 * dedicated home-screen icon that launches straight into that App — not the
 * vault root. Each page gets a distinct `id` so phones treat them as separate
 * installable mini-apps. Gated on `note_type === "app"`.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const path = url.searchParams.get("path");
    if (!path) {
      throw new VaultError("INVALID_PATH", "An App page \"path\" is required.");
    }

    const page = await readPage(path);
    if (page.metadata.note_type !== "app") {
      throw new VaultError("NOT_AN_APP_PAGE", "This page is not an App page.", 400);
    }

    const encodedPath = encodeURIComponent(page.path);
    const startUrl = `/app?path=${encodedPath}&source=pwa`;
    const title = page.title || "App";
    const shortName = title.length > 12 ? `${title.slice(0, 11)}…` : title;

    const manifest = {
      name: `${title} — App`,
      short_name: shortName,
      description: `Focused app for “${title}”`,
      // Distinct id per page so each installed shortcut is its own mini-app.
      id: `/app?path=${encodedPath}`,
      start_url: startUrl,
      scope: "/app",
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
