import fs from "node:fs/promises";
import { NextResponse } from "next/server";
import { capturePage, saveReferenceSidecar, toApiPageDocument, type ReferenceType } from "@/server/vault/pages";
import { toErrorResponse, VaultError } from "@/server/vault/errors";
import { resolveVaultPath } from "@/server/vault/paths";
import { emitVaultSideEffects } from "@/server/vault/socket-events";
import { authorizeIngestRequest, type IngestAuthMode } from "@/server/ingest-auth";
import { resolveAllowlistedDestination } from "@/server/ingest-destinations";

const VALID_REFERENCE_TYPES = new Set<ReferenceType>(["article", "paper", "web"]);

interface IngestPayload {
  title?: unknown;
  sourceUrl?: unknown;
  content?: unknown;
  type?: unknown;
  author?: unknown;
  publishedDate?: unknown;
  tags?: unknown;
  destination?: unknown;
}

interface NormalizedIngestPayload {
  title: string;
  sourceUrl: string;
  content: string;
  type: ReferenceType;
  author?: string;
  publishedDate?: string;
  tags: string[];
  destination?: {
    id?: string;
    notebookPath?: string;
    sectionPath?: string;
  };
}

function trimString(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim() || undefined : undefined;
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(
    new Set(value.map((tag) => trimString(tag)).filter((tag): tag is string => Boolean(tag)))
  );
}

function normalizeDestination(value: unknown): NormalizedIngestPayload["destination"] {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const raw = value as { id?: unknown; notebookPath?: unknown; sectionPath?: unknown };
  const id = trimString(raw.id);
  const notebookPath = trimString(raw.notebookPath);
  const sectionPath = trimString(raw.sectionPath);
  if (!id && !notebookPath && !sectionPath) {
    return undefined;
  }
  return { id, notebookPath, sectionPath };
}

function normalizePayload(raw: IngestPayload): NormalizedIngestPayload {
  const title = trimString(raw.title);
  const sourceUrl = trimString(raw.sourceUrl);
  const content = typeof raw.content === "string" ? raw.content : undefined;
  const type = trimString(raw.type);

  if (!title) {
    throw new VaultError("INVALID_PAYLOAD", "\"title\" is required.");
  }
  if (!sourceUrl) {
    throw new VaultError("INVALID_PAYLOAD", "\"sourceUrl\" is required.");
  }
  if (content === undefined) {
    throw new VaultError("INVALID_PAYLOAD", "\"content\" must be an HTML string.");
  }
  if (!type || !VALID_REFERENCE_TYPES.has(type as ReferenceType)) {
    throw new VaultError("INVALID_PAYLOAD", "\"type\" must be article, paper, or web.");
  }

  return {
    title,
    sourceUrl,
    content,
    type: type as ReferenceType,
    author: trimString(raw.author),
    publishedDate: trimString(raw.publishedDate),
    tags: normalizeTags(raw.tags),
    destination: normalizeDestination(raw.destination),
  };
}

async function directoryExists(relativePath: string, kind: "notebook" | "section") {
  try {
    const resolved = resolveVaultPath(relativePath, kind);
    const stat = await fs.stat(resolved.absolutePath).catch(() => null);
    return Boolean(stat?.isDirectory());
  } catch {
    return false;
  }
}

/**
 * Legacy capture resolution, retained only for the installed Android share
 * target posting directly to the app under the same-origin exemption. It keeps
 * the historical global-Inbox fallback; external senders do not get it.
 */
async function resolveLocalCaptureDestination(destination: NormalizedIngestPayload["destination"]) {
  if (destination?.sectionPath && await directoryExists(destination.sectionPath, "section")) {
    return {
      destination: "page" as const,
      sectionPath: destination.sectionPath,
    };
  }

  if (destination?.notebookPath && await directoryExists(destination.notebookPath, "notebook")) {
    return {
      destination: "inbox" as const,
      notebookPath: destination.notebookPath,
    };
  }

  return {
    destination: "inbox" as const,
  };
}

/**
 * Allowlisted capture resolution for external (bearer-authenticated) senders.
 * The destination has already been proven to be inside the allowlist; the only
 * remaining question is whether the requested section exists on disk. If it does
 * not, the page lands in the allowlisted notebook's own Inbox — never the global
 * one (SN-234).
 */
async function resolveExternalCaptureDestination(destination: NormalizedIngestPayload["destination"]) {
  const { entry, sectionPath } = resolveAllowlistedDestination(destination);

  if (sectionPath && await directoryExists(sectionPath, "section")) {
    return {
      destination: "page" as const,
      sectionPath,
    };
  }

  return {
    destination: "inbox" as const,
    notebookPath: entry.notebookPath,
  };
}

function resolveCaptureDestination(
  mode: IngestAuthMode,
  destination: NormalizedIngestPayload["destination"]
) {
  return mode === "bearer"
    ? resolveExternalCaptureDestination(destination)
    : resolveLocalCaptureDestination(destination);
}

/**
 * POST /api/ingest
 */
export async function POST(request: Request) {
  try {
    const authMode = authorizeIngestRequest(request);
    const payload = normalizePayload((await request.json().catch(() => ({}))) as IngestPayload);
    const captureDestination = await resolveCaptureDestination(authMode, payload.destination);
    const page = await capturePage({
      ...captureDestination,
      title: payload.title,
      content: payload.content,
    });
    const reference = await saveReferenceSidecar(page.path, {
      sourceUrl: payload.sourceUrl,
      author: payload.author,
      publishedDate: payload.publishedDate,
      type: payload.type,
      tags: payload.tags,
    });
    emitVaultSideEffects({ treeChanged: true });
    return NextResponse.json({ page: toApiPageDocument(page), reference }, { status: 201 });
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, {
      status: response.status,
      headers: response.status === 401 ? { "WWW-Authenticate": "Bearer" } : undefined,
    });
  }
}
