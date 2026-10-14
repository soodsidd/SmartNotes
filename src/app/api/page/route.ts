import { setPageRole } from "@/server/vault/recipes";
import { NextResponse } from "next/server";
import { createPage, deletePage, movePage, nestPage, readPage, readPaperSnapshot, renamePage, savePage, setPageKeyNote, setPageLines, toApiPageDocument } from "@/server/vault/pages";
import { isBibliographyPath } from "@/lib/papers";
import { toErrorResponse, VaultError } from "@/server/vault/errors";
import { emitVaultSideEffects } from "@/server/vault/socket-events";

function searchParamPath(request: Request) {
  const url = new URL(request.url);
  const pagePath = url.searchParams.get("path");
  if (!pagePath) {
    throw new VaultError("INVALID_PATH", "Query parameter \"path\" is required.");
  }
  return pagePath;
}

export async function GET(request: Request) {
  try {
    const pagePath = searchParamPath(request);
    if (isBibliographyPath(pagePath)) {
      const snapshot = await readPaperSnapshot(pagePath);
      return NextResponse.json({ page: toApiPageDocument(snapshot.page), revision: snapshot.revision });
    }
    const page = await readPage(pagePath);
    return NextResponse.json({ page: toApiPageDocument(page) });
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      sectionPath?: string;
      notebookPath?: string;
      title?: string;
      noteType?: string;
      parentId?: string | null;
      pageLines?: unknown;
    };
    const noteType =
      body.noteType === "ink"
        ? "ink"
        : body.noteType === "jupyter"
          ? "jupyter"
          : body.noteType === "log"
            ? "log"
            : body.noteType === "design"
              ? "design"
              : body.noteType === "app"
                ? "app"
                : body.noteType === "spreadsheet"
                  ? "spreadsheet"
              : "text";
    const page = await createPage({
      sectionPath: body.sectionPath ?? null,
      notebookPath: body.notebookPath ?? null,
      title: body.title ?? "Untitled page",
      noteType,
      parentId: body.parentId !== undefined ? body.parentId : null,
      pageLines: body.pageLines ?? null,
    });
    emitVaultSideEffects({ treeChanged: true });
    return NextResponse.json({ page: toApiPageDocument(page) }, { status: 201 });
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

export async function PUT(request: Request) {
  try {
    // Accept "content" (reliable shell) or "body" (legacy shell) for the markdown text.
    const body = (await request.json()) as {
      path?: string;
      title?: string;
      body?: string;
      content?: string;
      originSocketId?: string;
      originClientId?: string;
      expectedPaperRevision?: string;
    };
    const page = await savePage({
      path: body.path ?? "",
      title: body.title ?? "",
      body: body.content ?? body.body ?? "",
      expectedPaperRevision: body.expectedPaperRevision,
    });
    const fileUpdated: { path: string; content: string; originSocketId?: string; originClientId?: string } = {
      path: page.path,
      content: page.body,
    };
    if (body.originSocketId) {
      fileUpdated.originSocketId = body.originSocketId;
    }
    if (body.originClientId) {
      fileUpdated.originClientId = body.originClientId;
    }
    emitVaultSideEffects({
      fileUpdated,
    });
    const revision = body.expectedPaperRevision ? (await readPaperSnapshot(page.path)).revision : undefined;
    return NextResponse.json({ page: toApiPageDocument(page), ...(revision ? { revision } : {}) });
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

export async function PATCH(request: Request) {
  try {
    // action = "rename" (default) | "move"
    const body = (await request.json()) as {
      action?: string;
      path?: string;
      title?: string;
      sectionPath?: string;
      targetSectionPath?: string;
    };

    if (body.action === "recipe" || body.action === "notebook_instructions") {
      const enabled = (body as { enabled?: unknown }).enabled;
      if (typeof enabled !== "boolean") throw new VaultError("INVALID_INPUT", '"enabled" must be a boolean.', 400);
      const page = await setPageRole(body.path ?? "", body.action, enabled);
      emitVaultSideEffects({ treeChanged: true });
      return NextResponse.json({ page: toApiPageDocument(page) });
    }
    if (body.action === "move") {
      const page = await movePage(body.path ?? "", body.sectionPath ?? body.targetSectionPath ?? "");
      emitVaultSideEffects({ treeChanged: true });
      return NextResponse.json({ page: toApiPageDocument(page) });
    }

    if (body.action === "nest") {
      const nestBody = body as { action: "nest"; path?: string; parentId?: string | null };
      const parentId = nestBody.parentId !== undefined ? nestBody.parentId : null;
      const page = await nestPage({ path: nestBody.path ?? "", parentId });
      emitVaultSideEffects({ treeChanged: true });
      return NextResponse.json({ page: toApiPageDocument(page) });
    }

    if (body.action === "keyNote") {
      const keyNoteBody = body as { action: "keyNote"; path?: string; keyNote?: unknown };
      if (typeof keyNoteBody.keyNote !== "boolean") {
        throw new VaultError("INVALID_INPUT", '"keyNote" must be a boolean.', 400);
      }
      const page = await setPageKeyNote({
        path: keyNoteBody.path ?? "",
        keyNote: keyNoteBody.keyNote,
      });
      emitVaultSideEffects({ treeChanged: true });
      return NextResponse.json({ page: toApiPageDocument(page) });
    }

    if (body.action === "pageLines") {
      const linesBody = body as { action: "pageLines"; path?: string; pageLines?: unknown };
      if (!linesBody.pageLines || typeof linesBody.pageLines !== "object") {
        throw new VaultError("INVALID_INPUT", '"pageLines" must be an object.', 400);
      }
      const page = await setPageLines({
        path: linesBody.path ?? "",
        pageLines: linesBody.pageLines,
      });
      emitVaultSideEffects({ treeChanged: true });
      return NextResponse.json({ page: toApiPageDocument(page) });
    }

    if (
      body.action === "previewAttachment" ||
      body.action === "copyAttachment" ||
      body.action === "aiSpliceCommit"
    ) {
      throw new VaultError(
        "UNSUPPORTED_ACTION",
        "Smart Notes AI edits the active Markdown record directly; editor-side attachment and splice commits are disabled."
      );
    }

    const page = await renamePage(body.path ?? "", body.title ?? "");
    emitVaultSideEffects({ treeChanged: true });
    return NextResponse.json({ page: toApiPageDocument(page) });
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

export async function DELETE(request: Request) {
  try {
    // Path arrives as a query param (?path=…) — consistent with GET.
    const pagePath = searchParamPath(request);
    const result = await deletePage(pagePath);
    emitVaultSideEffects({ treeChanged: true });
    return NextResponse.json(result);
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
