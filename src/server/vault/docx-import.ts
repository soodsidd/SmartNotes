import path from "node:path";
import mammoth from "mammoth";
import { VaultError } from "./errors";

export interface DocxImportedImage {
  placeholder: string;
  fileName: string;
  buffer: Buffer;
}

export interface ParsedDocxDocument {
  title: string;
  bodyHtml: string;
  images: DocxImportedImage[];
}

function safeFileName(input: string, fallback: string) {
  const base = path.basename(input).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim();
  return base || fallback;
}

export async function parseDocxBuffer(buffer: Buffer, fileName = "Imported DOCX"): Promise<ParsedDocxDocument> {
  const images: DocxImportedImage[] = [];
  let imageIndex = 0;

  let result: { value: string; messages: unknown[] };
  try {
    result = await mammoth.convertToHtml(
      { buffer },
      {
        convertImage: mammoth.images.imgElement(async (image) => {
          imageIndex += 1;
          const ext = image.contentType.split("/")[1] ?? "png";
          const rawName = `image-${imageIndex}.${ext}`;
          const imgFileName = safeFileName(rawName, rawName);
          const placeholder = `__SN_DOCX_IMAGE_${imageIndex}__`;
          const imgBuffer = Buffer.from(await image.read());
          images.push({ placeholder, fileName: imgFileName, buffer: imgBuffer });
          return { src: placeholder };
        }),
      }
    );
  } catch {
    throw new VaultError("INVALID_DOCX", "The selected file is not a readable DOCX package.", 400);
  }

  const bodyHtml = result.value.trim() || "<p></p>";

  // Extract title from the first h1 in the output, or fall back to filename
  const h1Match = bodyHtml.match(/<h1[^>]*>(.*?)<\/h1>/i);
  const firstHeading = h1Match ? h1Match[1].replace(/<[^>]+>/g, "").trim() : "";
  const fallbackTitle = path.basename(fileName, path.extname(fileName)).trim() || "Imported DOCX";

  return {
    title: firstHeading || fallbackTitle,
    bodyHtml,
    images,
  };
}
