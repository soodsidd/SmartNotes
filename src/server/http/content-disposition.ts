/**
 * Build a Content-Disposition header safe for Unicode filenames.
 * Node/undici require header values to be ByteStrings (Latin-1). Non-ASCII
 * titles (e.g. em-dash) must use RFC 5987 filename* with an ASCII fallback.
 */
export function buildAttachmentContentDisposition(fileName: string, extension = ""): string {
  const trimmed = (fileName.trim() || "Smart Notes page")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 120) || "Smart Notes page";

  const fullName =
    extension && !trimmed.toLowerCase().endsWith(extension.toLowerCase())
      ? `${trimmed}${extension}`
      : trimmed;

  const asciiFallback = fullName.replace(/[^\x20-\x7E]/g, "-");
  const encoded = encodeURIComponent(fullName).replace(
    /['()*]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`
  );

  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}
