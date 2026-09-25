import { NextResponse } from "next/server";
import { readPage } from "@/server/vault/pages";
import { toErrorResponse, VaultError } from "@/server/vault/errors";
import { parseFrontmatterDocument } from "@/server/vault/frontmatter";
import {
  listPageVersions,
  readPageVersionContent,
  restorePageVersion,
  snapshotPageByNoteType,
} from "@/server/vault/versions";
import { emitVaultSideEffects } from "@/server/vault/socket-events";

function versionTimestampFromId(versionId: string) {
  const separator = versionId.lastIndexOf("_");
  if (separator <= 0) {
    return versionId;
  }
  return versionId.slice(0, separator);
}

function searchParamPath(request: Request) {
  const url = new URL(request.url);
  const pagePath = url.searchParams.get("path");
  if (!pagePath) {
    throw new Error("Query parameter \"path\" is required.");
  }
  return pagePath;
}

export async function GET(request: Request) {
  try {
    const pagePath = searchParamPath(request);
    const page = await readPage(pagePath);
    const noteType =
      page.metadata.note_type === "ink"
        ? "ink"
        : page.metadata.note_type === "spreadsheet"
          ? "spreadsheet"
        : page.metadata.note_type === "jupyter"
          ? "jupyter"
          : "text";
    if (noteType === "jupyter") {
      throw new VaultError(
        "UNSUPPORTED_NOTE_TYPE",
        "Jupyter notebook contents are managed by Jupyter and are not included in Smart Notes page versions.",
        400
      );
    }
    const kind = noteType === "ink" ? "ink" : noteType === "spreadsheet" ? "spreadsheet" : "page";
    const url = new URL(request.url);
    const versionId = url.searchParams.get("versionId");
    if (versionId) {
      const rawContent = await readPageVersionContent(pagePath, versionId, kind);
      const content =
        noteType === "text" ? parseFrontmatterDocument(rawContent).body : rawContent;

      let annotationsContent: string | null = null;
      if (noteType === "text") {
        const versionTs = versionTimestampFromId(versionId);
        const annotationsVersions = await listPageVersions(pagePath, "annotations");
        const match = annotationsVersions.find(
          (entry) => versionTimestampFromId(entry.id) === versionTs
        );
        if (match) {
          annotationsContent = await readPageVersionContent(pagePath, match.id, "annotations");
        }
      }

      return NextResponse.json({ content, annotationsContent, noteType, versionId });
    }
    const versions = await listPageVersions(pagePath, kind);
    return NextResponse.json({ versions, noteType });
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      path?: string;
      action?: string;
      versionId?: string;
      originSocketId?: string;
      originClientId?: string;
    };

    const pagePath = body.path ?? "";
    const page = await readPage(pagePath);
    const noteType =
      page.metadata.note_type === "ink"
        ? "ink"
        : page.metadata.note_type === "spreadsheet"
          ? "spreadsheet"
        : page.metadata.note_type === "jupyter"
          ? "jupyter"
          : "text";
    if (noteType === "jupyter") {
      throw new VaultError(
        "UNSUPPORTED_NOTE_TYPE",
        "Jupyter notebook contents are managed by Jupyter and are not included in Smart Notes page versions.",
        400
      );
    }

    if (body.action === "restore") {
      if (!body.versionId) {
        return NextResponse.json({ error: "versionId is required." }, { status: 400 });
      }
      const result = await restorePageVersion(pagePath, body.versionId, noteType);
      const restoredPage = await readPage(pagePath);
      const fileUpdated: { path: string; content: string; originSocketId?: string; originClientId?: string } = {
        path: restoredPage.path,
        content: restoredPage.body,
      };
      if (body.originSocketId) {
        fileUpdated.originSocketId = body.originSocketId;
      }
      if (body.originClientId) {
        fileUpdated.originClientId = body.originClientId;
      }
      emitVaultSideEffects({
        treeChanged: true,
        fileUpdated,
      });
      return NextResponse.json({ ok: true, ...result });
    }

    const snapshot = await snapshotPageByNoteType(pagePath, noteType);
    return NextResponse.json({
      created: snapshot.created,
      entry: snapshot.entry,
      noteType,
    });
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
