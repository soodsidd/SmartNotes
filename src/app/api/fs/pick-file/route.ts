import { NextResponse } from "next/server";
import { isNativeFilePickerAvailable, pickNativeFile } from "@/server/fs/native-file-picker";
import { toErrorResponse } from "@/server/vault/errors";

export const dynamic = "force-dynamic";

/** POST /api/fs/pick-file — open the native OS file picker on the server machine */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      initialPath?: string;
      title?: string;
      filter?: string;
    };

    if (!isNativeFilePickerAvailable()) {
      return NextResponse.json(
        {
          error: "Native file picker is only available when Smart Notes runs on Windows.",
          code: "UNSUPPORTED",
          available: false,
          cancelled: true,
          path: null,
        },
        { status: 501 }
      );
    }

    const result = await pickNativeFile(body);
    return NextResponse.json({
      available: true,
      ...result,
    });
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
