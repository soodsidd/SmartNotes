import { NextResponse } from "next/server";
import { isNativeFolderPickerAvailable, pickNativeFolder } from "@/server/fs/native-folder-picker";
import { toErrorResponse } from "@/server/vault/errors";

export const dynamic = "force-dynamic";

/** POST /api/fs/pick-folder — open the native OS folder picker on the server machine */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      initialPath?: string;
      title?: string;
    };

    if (!isNativeFolderPickerAvailable()) {
      return NextResponse.json(
        {
          error: "Native folder picker is only available when Smart Notes runs on Windows.",
          code: "UNSUPPORTED",
          available: false,
          cancelled: true,
          path: null,
        },
        { status: 501 }
      );
    }

    const result = await pickNativeFolder(body);
    return NextResponse.json({
      available: true,
      ...result,
    });
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
