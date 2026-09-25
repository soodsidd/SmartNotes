import fs from "node:fs/promises";
import path from "node:path";
import * as cheerio from "cheerio";
import type { AnyNode, Element, Text } from "domhandler";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  ImageRun,
  Table,
  TableRow,
  TableCell,
  ExternalHyperlink,
  UnderlineType,
  AlignmentType,
  WidthType,
  BorderStyle,
  LevelFormat,
  convertInchesToTwip,
} from "docx";
import { resolveVaultPath, toVaultRelativePath } from "./paths";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type DocxChild = Paragraph | Table;

interface RunOptions {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  code?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function vaultUrlToFsPath(vaultUrl: string): string | null {
  if (!vaultUrl.startsWith("/vault/")) return null;
  const relativePath = vaultUrl
    .slice("/vault/".length)
    .split("/")
    .map((seg) => decodeURIComponent(seg))
    .join("/");
  try {
    return resolveVaultPath(toVaultRelativePath(relativePath), "section").absolutePath;
  } catch {
    return null;
  }
}

function makeRun(text: string, opts: RunOptions = {}, hyperlinkId?: string): TextRun {
  return new TextRun({
    text,
    bold: opts.bold,
    italics: opts.italic,
    underline: opts.underline ? { type: UnderlineType.SINGLE } : undefined,
    strike: opts.strike,
    font: opts.code ? "Courier New" : undefined,
    size: opts.code ? 18 : undefined,
    style: hyperlinkId ? "Hyperlink" : undefined,
  });
}

// ---------------------------------------------------------------------------
// Image loading
// ---------------------------------------------------------------------------
const FALLBACK_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);

async function loadImage(src: string): Promise<{ buffer: Buffer; ext: string } | null> {
  const fsPath = vaultUrlToFsPath(src);
  if (!fsPath) return null;
  try {
    const buffer = await fs.readFile(fsPath);
    const ext = path.extname(fsPath).toLowerCase().replace(".", "") || "png";
    return { buffer, ext };
  } catch {
    return null;
  }
}

type ImageType = "jpg" | "png" | "gif" | "bmp";
function toImageType(ext: string): ImageType {
  if (ext === "jpeg" || ext === "jpg") return "jpg";
  if (ext === "gif") return "gif";
  if (ext === "bmp") return "bmp";
  // SVG not supported by docx ImageRun without fallback — treat as png placeholder
  return "png";
}

// ---------------------------------------------------------------------------
// Inline content → docx runs
// ---------------------------------------------------------------------------
type InlineItem =
  | { kind: "run"; text: string; opts: RunOptions }
  | { kind: "hyperlink"; href: string; children: InlineItem[] }
  | { kind: "image"; src: string };

function collectInline($: ReturnType<typeof cheerio.load>, node: AnyNode, opts: RunOptions): InlineItem[] {
  const out: InlineItem[] = [];

  function walk(n: AnyNode, o: RunOptions) {
    if (n.type === "text") {
      const t = (n as Text).data ?? "";
      if (t) out.push({ kind: "run", text: t, opts: { ...o } });
      return;
    }
    if (n.type !== "tag") return;
    const el = n as Element;
    const tag = el.name.toLowerCase();

    // Math node — degrade to plain text
    if (el.attribs?.["data-type"] === "math") {
      const latex = el.attribs?.["data-latex"] ?? $(el).find("[data-latex]").first().attr("data-latex") ?? $(el).text().trim();
      if (latex) out.push({ kind: "run", text: `[math: ${latex}]`, opts: { ...o } });
      return;
    }
    if (el.attribs?.class?.includes("katex")) return;
    if (el.attribs?.["aria-hidden"] === "true") return;
    if (el.attribs?.class?.includes("file-attachment")) return;

    let next = { ...o };
    switch (tag) {
      case "strong": case "b": next = { ...next, bold: true }; break;
      case "em":    case "i": next = { ...next, italic: true }; break;
      case "u":               next = { ...next, underline: true }; break;
      case "s": case "del": case "strike": next = { ...next, strike: true }; break;
      case "code":            next = { ...next, code: true }; break;
      case "a": {
        const href = el.attribs?.href ?? "";
        if (href) {
          const children: InlineItem[] = [];
          for (const child of el.children ?? []) {
            const before = out.length;
            walk(child, next);
            children.push(...out.splice(before));
          }
          out.push({ kind: "hyperlink", href, children });
          return;
        }
        break;
      }
      case "img": {
        const src = el.attribs?.src ?? "";
        if (src) out.push({ kind: "image", src });
        return;
      }
      case "br":
        out.push({ kind: "run", text: "\n", opts: { ...o } });
        return;
    }
    for (const child of el.children ?? []) walk(child, next);
  }

  walk(node, opts);
  return out;
}

async function inlineItemsToDocxChildren(
  items: InlineItem[]
): Promise<(TextRun | ExternalHyperlink | ImageRun)[]> {
  const out: (TextRun | ExternalHyperlink | ImageRun)[] = [];
  for (const item of items) {
    if (item.kind === "run") {
      out.push(makeRun(item.text, item.opts));
    } else if (item.kind === "hyperlink") {
      const inner = await inlineItemsToDocxChildren(item.children);
      out.push(
        new ExternalHyperlink({
          link: item.href,
          children: inner.filter((c): c is TextRun => c instanceof TextRun),
        })
      );
    } else if (item.kind === "image") {
      const img = await loadImage(item.src);
      if (img) {
        out.push(
          new ImageRun({
            data: img.buffer,
            type: toImageType(img.ext),
            transformation: { width: 432, height: 288 },
          })
        );
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Block-level processing
// ---------------------------------------------------------------------------
interface ListState {
  bulletNumId: number;
  orderedNumId: number;
}

async function processBlock(
  $: ReturnType<typeof cheerio.load>,
  el: Element,
  listState: ListState
): Promise<DocxChild[]> {
  const tag = el.name.toLowerCase();

  switch (tag) {
    case "h1": case "h2": case "h3": case "h4": case "h5": case "h6": {
      const levelMap: Record<string, typeof HeadingLevel[keyof typeof HeadingLevel]> = {
        h1: HeadingLevel.HEADING_1,
        h2: HeadingLevel.HEADING_2,
        h3: HeadingLevel.HEADING_3,
        h4: HeadingLevel.HEADING_4,
        h5: HeadingLevel.HEADING_5,
        h6: HeadingLevel.HEADING_6,
      };
      const items = collectInline($, el, {});
      const children = await inlineItemsToDocxChildren(items);
      return [new Paragraph({ heading: levelMap[tag], children })];
    }

    case "p": {
      const items = collectInline($, el, {});
      const children = await inlineItemsToDocxChildren(items);
      return [new Paragraph({ children })];
    }

    case "blockquote": {
      const out: DocxChild[] = [];
      for (const child of el.children ?? []) {
        if (child.type !== "tag") continue;
        const inner = await processBlock($, child as Element, listState);
        out.push(...inner);
      }
      return out;
    }

    case "pre": {
      const text = $(el).text();
      return text.split("\n").map(
        (line) => new Paragraph({
          style: "PreformattedText",
          children: [new TextRun({ text: line, font: "Courier New", size: 20 })],
        })
      );
    }

    case "ul": case "ol": {
      const isOrdered = tag === "ol";
      return processListEl($, el, listState, isOrdered ? listState.orderedNumId : listState.bulletNumId, 0, isOrdered);
    }

    case "table":
      return [await processTable($, el, listState)];

    case "figure": case "div": {
      const out: DocxChild[] = [];
      for (const child of el.children ?? []) {
        if (child.type !== "tag") continue;
        const inner = await processBlock($, child as Element, listState);
        out.push(...inner);
      }
      return out;
    }

    case "img": {
      const src = el.attribs?.src ?? "";
      const img = await loadImage(src);
      if (!img) return [];
      return [new Paragraph({
        children: [new ImageRun({
          data: img.buffer,
          type: toImageType(img.ext),
          transformation: { width: 432, height: 288 },
        })],
      })];
    }

    case "hr":
      return [new Paragraph({
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "auto", space: 1 } },
        children: [],
      })];

    default: {
      const items = collectInline($, el, {});
      const children = await inlineItemsToDocxChildren(items);
      return children.length ? [new Paragraph({ children })] : [];
    }
  }
}

async function processListEl(
  $: ReturnType<typeof cheerio.load>,
  listEl: Element,
  listState: ListState,
  numId: number,
  depth: number,
  isOrdered: boolean
): Promise<DocxChild[]> {
  const out: DocxChild[] = [];
  for (const child of listEl.children ?? []) {
    if (child.type !== "tag") continue;
    const liEl = child as Element;
    if (liEl.name.toLowerCase() !== "li") continue;

    let emittedPara = false;
    for (const liChild of liEl.children ?? []) {
      if (liChild.type !== "tag") continue;
      const lcEl = liChild as Element;
      const lcTag = lcEl.name.toLowerCase();
      if (lcTag === "ul") {
        out.push(...(await processListEl($, lcEl, listState, listState.bulletNumId, depth + 1, false)));
      } else if (lcTag === "ol") {
        out.push(...(await processListEl($, lcEl, listState, listState.orderedNumId, depth + 1, true)));
      } else if (lcTag === "p") {
        const items = collectInline($, lcEl, {});
        const children = await inlineItemsToDocxChildren(items);
        out.push(new Paragraph({
          numbering: { reference: isOrdered ? "ordered-list" : "bullet-list", level: depth },
          children,
        }));
        emittedPara = true;
      }
    }
    if (!emittedPara) {
      const items = collectInline($, liEl, {});
      const children = await inlineItemsToDocxChildren(items);
      out.push(new Paragraph({
        numbering: { reference: isOrdered ? "ordered-list" : "bullet-list", level: depth },
        children,
      }));
    }
  }
  return out;
}

async function processTable(
  $: ReturnType<typeof cheerio.load>,
  tableEl: Element,
  listState: ListState
): Promise<Table> {
  const rows: TableRow[] = [];
  for (const trEl of $(tableEl).find("tr").toArray()) {
    const cells: TableCell[] = [];
    for (const tcEl of $(trEl).find("td,th").toArray()) {
      const isHeader = (tcEl as Element).name.toLowerCase() === "th";
      const items = collectInline($, tcEl as Element, { bold: isHeader });
      const children = await inlineItemsToDocxChildren(items);
      cells.push(new TableCell({
        children: [new Paragraph({ children })],
        width: { size: 0, type: WidthType.AUTO },
      }));
    }
    rows.push(new TableRow({ children: cells }));
  }
  return new Table({
    rows,
    width: { size: 100, type: WidthType.PERCENTAGE },
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export interface DocxExportInput {
  title: string;
  bodyHtml: string;
  vaultRoot: string;
}

function stripDuplicateLeadingH1(html: string, title: string) {
  const $ = cheerio.load(`<div id="root">${html}</div>`);
  const first = $("#root").children().first();
  if (first.length && first.get(0)?.type === "tag" && first.prop("tagName")?.toLowerCase() === "h1") {
    if (first.text().trim() === title.trim()) first.remove();
  }
  return $("#root").html() ?? html;
}

export async function buildDocxBuffer(input: DocxExportInput): Promise<Buffer> {
  const cleanHtml = stripDuplicateLeadingH1(input.bodyHtml, input.title);
  const $ = cheerio.load(`<div id="root">${cleanHtml}</div>`);

  const listState: ListState = { bulletNumId: 0, orderedNumId: 1 };
  const bodyChildren: DocxChild[] = [];

  // Title as H1
  bodyChildren.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(input.title || "Untitled")] }));

  for (const el of $("#root").children().toArray()) {
    if (el.type !== "tag") continue;
    const blocks = await processBlock($, el as Element, listState);
    bodyChildren.push(...blocks);
  }

  const doc = new Document({
    numbering: {
      config: [
        {
          reference: "bullet-list",
          levels: [
            { level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: convertInchesToTwip(0.5), hanging: convertInchesToTwip(0.25) } } } },
            { level: 1, format: LevelFormat.BULLET, text: "o",       alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: convertInchesToTwip(1.0), hanging: convertInchesToTwip(0.25) } } } },
            { level: 2, format: LevelFormat.BULLET, text: "▪",  alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: convertInchesToTwip(1.5), hanging: convertInchesToTwip(0.25) } } } },
          ],
        },
        {
          reference: "ordered-list",
          levels: [
            { level: 0, format: LevelFormat.DECIMAL,       text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: convertInchesToTwip(0.5), hanging: convertInchesToTwip(0.25) } } } },
            { level: 1, format: LevelFormat.LOWER_LETTER,  text: "%2.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: convertInchesToTwip(1.0), hanging: convertInchesToTwip(0.25) } } } },
            { level: 2, format: LevelFormat.LOWER_ROMAN,   text: "%3.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: convertInchesToTwip(1.5), hanging: convertInchesToTwip(0.25) } } } },
          ],
        },
      ],
    },
    styles: {
      default: {
        document: {
          run: { font: "Calibri", size: 24 },
        },
      },
      paragraphStyles: [
        {
          id: "PreformattedText",
          name: "Preformatted Text",
          basedOn: "Normal",
          run: { font: "Courier New", size: 20 },
        },
      ],
      characterStyles: [
        {
          id: "Hyperlink",
          name: "Hyperlink",
          run: { color: "0563C1", underline: { type: UnderlineType.SINGLE } },
        },
      ],
    },
    sections: [{ children: bodyChildren }],
  });

  return Buffer.from(await Packer.toBuffer(doc));
}
