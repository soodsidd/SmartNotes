import { NextRequest, NextResponse } from "next/server";
import { invalidateVaultTreeCacheForTesting, readVaultTree } from "@/server/vault/pages";
import { toErrorResponse } from "@/server/vault/errors";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function devDiagnosticsEnabled() {
  return process.env.NODE_ENV !== "production" || process.env.ENABLE_DEV_SCREENS === "1";
}

export async function GET(request: NextRequest) {
  try {
    const sequential = request.nextUrl.searchParams.get("sequential") === "1";
    const skipCache = request.nextUrl.searchParams.get("skipCache") === "1";
    const notebookPath = request.nextUrl.searchParams.get("notebook") ?? undefined;
    const closedNotebookPaths = new Set(request.nextUrl.searchParams.getAll("closed"));

    const tree = await readVaultTree({
      sequential: sequential || undefined,
      skipCache: skipCache || undefined,
      notebookPath,
      closedNotebookPaths,
    });
    if (notebookPath && !tree.tree.some((notebook) => notebook.path === notebookPath)) {
      return NextResponse.json({ error: "Notebook not found." }, { status: 404 });
    }
    return NextResponse.json(tree);
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

export async function POST(request: NextRequest) {
  if (!devDiagnosticsEnabled()) {
    return NextResponse.json({ error: "Vault diagnostics are disabled in production." }, { status: 403 });
  }

  const action = request.nextUrl.searchParams.get("action");
  if (action !== "invalidate-cache") {
    return NextResponse.json({ error: "Unsupported vault action." }, { status: 400 });
  }

  invalidateVaultTreeCacheForTesting();
  return NextResponse.json({ ok: true });
}
