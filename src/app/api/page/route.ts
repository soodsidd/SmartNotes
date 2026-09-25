import { NextResponse } from "next/server";
import { createPage, deletePage, movePage, nestPage, readPage, renamePage, savePage, setPageKeyNote, toApiPageDocument } from "@/server/vault/pages";
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
    const page = await readPage(searchParamPath(request));
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
    };
    const page = await savePage({
      path: body.path ?? "",
      title: body.title ?? "",
      body: body.content ?? body.body ?? "",
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
    return NextResponse.json({ page: toApiPageDocument(page) });
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
