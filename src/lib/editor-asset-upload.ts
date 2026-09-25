/**
 * Editor asset upload helpers (SN-148 follow-on).
 *
 * Google Drive / cloud "online-only" placeholders often fail mid-stream when
 * the browser streams a File through FormData fetch — surfacing as the opaque
 * TypeError "Failed to fetch". Reading the bytes first either hydrates the
 * file into a stable Blob or fails early with an actionable message.
 */

export const CLOUD_FILE_READ_HINT =
  "Couldn't read that file. If it's on Google Drive or another cloud folder, open it once (or make it available offline), then attach again.";

const EMPTY_OR_SYNCING_HINT =
  "That file looks empty or still syncing from the cloud. Wait for the download to finish, then try again.";

/**
 * Map low-level read/fetch failures to an owner-facing message.
 */
export function describeAssetUploadFailure(error: unknown): string {
  if (!(error instanceof Error)) {
    return "Upload failed.";
  }

  if (
    error.name === "NotReadableError" ||
    error.name === "NotFoundError" ||
    error.message === CLOUD_FILE_READ_HINT ||
    error.message === EMPTY_OR_SYNCING_HINT
  ) {
    return error.message === EMPTY_OR_SYNCING_HINT
      ? EMPTY_OR_SYNCING_HINT
      : CLOUD_FILE_READ_HINT;
  }

  if (
    error.name === "TypeError" ||
    /failed to fetch/i.test(error.message) ||
    /networkerror/i.test(error.message)
  ) {
    return `Upload failed (network). ${CLOUD_FILE_READ_HINT}`;
  }

  return error.message || "Upload failed.";
}

/**
 * Fully read a picker File into a Blob before POST so cloud placeholders
 * cannot fail mid-upload with "Failed to fetch".
 */
export async function readFileForUpload(file: File): Promise<Blob> {
  if (!Number.isFinite(file.size) || file.size <= 0) {
    throw new Error(EMPTY_OR_SYNCING_HINT);
  }

  try {
    const buffer = await readFileArrayBuffer(file);
    if (buffer.byteLength <= 0) {
      throw new Error(EMPTY_OR_SYNCING_HINT);
    }
    return new Blob([buffer], {
      type: file.type || "application/octet-stream",
    });
  } catch (error) {
    if (error instanceof Error && error.message === EMPTY_OR_SYNCING_HINT) {
      throw error;
    }
    throw new Error(CLOUD_FILE_READ_HINT);
  }
}

async function readFileArrayBuffer(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === "function") {
    return file.arrayBuffer();
  }

  // jsdom / older runtimes: fall back to FileReader.
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => {
      reject(reader.error ?? new Error("read failed"));
    };
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(reader.result);
        return;
      }
      reject(new Error("read failed"));
    };
    reader.readAsArrayBuffer(file);
  });
}
