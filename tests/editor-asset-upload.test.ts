/**
 * @jest-environment jsdom
 *
 * SN-148 follow-on: Google Drive / cloud picker Files must be fully read
 * before FormData upload so mid-stream "Failed to fetch" is avoided or
 * replaced with an actionable message.
 */

import {
  CLOUD_FILE_READ_HINT,
  MAX_PAGE_ASSET_BYTES,
  MAX_PDF_ASSET_BYTES,
  PDF_ASSET_TOO_LARGE_HINT,
  pageAssetLimit,
  PAGE_ASSET_TOO_LARGE_HINT,
  describeAssetUploadFailure,
  readFileForUpload,
} from "@/lib/editor-asset-upload";

describe("describeAssetUploadFailure", () => {
  test("maps Failed to fetch to a cloud-aware network message", () => {
    const message = describeAssetUploadFailure(new TypeError("Failed to fetch"));
    expect(message).toContain("Upload failed (network)");
    expect(message).toContain("Google Drive");
  });

  test("maps NotReadableError to the cloud read hint", () => {
    const error = new Error("read failed");
    error.name = "NotReadableError";
    expect(describeAssetUploadFailure(error)).toBe(CLOUD_FILE_READ_HINT);
  });

  test("preserves server-provided upload errors", () => {
    expect(describeAssetUploadFailure(new Error("Asset upload failed."))).toBe(
      "Asset upload failed."
    );
  });
});

describe("readFileForUpload", () => {
  test("rejects empty / still-syncing files before fetch", async () => {
    const empty = new File([], "cloud.pdf", { type: "application/pdf" });
    await expect(readFileForUpload(empty)).rejects.toThrow(/empty or still syncing/i);
  });

  test("rejects oversized files before reading bytes", async () => {
    const read = jest.fn();
    const file = { name: "archive.zip", size: MAX_PAGE_ASSET_BYTES + 1, type: "application/zip", arrayBuffer: read } as unknown as File;
    await expect(readFileForUpload(file)).rejects.toThrow(PAGE_ASSET_TOO_LARGE_HINT);
    expect(read).not.toHaveBeenCalled();
  });

  test("PDFs up to 200 MiB pass the size check; other files keep the 50 MiB cap", async () => {
    const read = jest.fn(async () => new Uint8Array([1, 2, 3]).buffer);
    const bigPdf = { name: "scan.pdf", size: 150 * 1024 * 1024, type: "application/pdf", arrayBuffer: read } as unknown as File;
    await expect(readFileForUpload(bigPdf)).resolves.toBeInstanceOf(Blob);
    expect(read).toHaveBeenCalledTimes(1);

    const bigZip = { name: "data.zip", size: 150 * 1024 * 1024, type: "application/zip", arrayBuffer: read } as unknown as File;
    await expect(readFileForUpload(bigZip)).rejects.toThrow(PAGE_ASSET_TOO_LARGE_HINT);
  });

  test("rejects PDFs over 200 MiB before reading bytes", async () => {
    const read = jest.fn();
    const file = { name: "huge.pdf", size: MAX_PDF_ASSET_BYTES + 1, type: "application/pdf", arrayBuffer: read } as unknown as File;
    await expect(readFileForUpload(file)).rejects.toThrow(PDF_ASSET_TOO_LARGE_HINT);
    expect(read).not.toHaveBeenCalled();
  });

  test("recognises PDFs by extension when the browser sends no MIME type", () => {
    expect(pageAssetLimit({ name: "Paper.PDF", type: "" }).maxBytes).toBe(MAX_PDF_ASSET_BYTES);
    expect(pageAssetLimit({ name: "photo.png", type: "image/png" }).maxBytes).toBe(MAX_PAGE_ASSET_BYTES);
  });

  test("returns a Blob with the file bytes when readable", async () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF
    const file = new File([bytes], "local.pdf", { type: "application/pdf" });
    const blob = await readFileForUpload(file);
    expect(blob.size).toBe(4);
    expect(blob.type).toBe("application/pdf");
    const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error ?? new Error("read failed"));
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.readAsArrayBuffer(blob);
    });
    expect(new Uint8Array(buffer)).toEqual(bytes);
  });

  test("maps arrayBuffer failures to the cloud read hint", async () => {
    const file = {
      name: "drive.pdf",
      size: 3,
      type: "application/pdf",
      arrayBuffer: async () => {
        throw Object.assign(new Error("locked"), { name: "NotReadableError" });
      },
    } as File;
    await expect(readFileForUpload(file)).rejects.toThrow(CLOUD_FILE_READ_HINT);
  });
});
