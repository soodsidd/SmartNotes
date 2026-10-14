import { parse, parseFragment } from "parse5";

type LocatedNode = {
  tagName?: string;
  childNodes?: LocatedNode[];
  sourceCodeLocation?: {
    startOffset: number;
    endOffset: number;
    startTag?: { endOffset: number };
    endTag?: { startOffset: number };
  };
};

function children(node: LocatedNode): LocatedNode[] {
  return (node.childNodes ?? []).filter((child) => Boolean(child.tagName));
}

/** Replace only the selected block's bytes. Other source, including head/style, stays exact. */
export function applyDesignElementEdit(
  html: string,
  elementPath: number[],
  replacement: string,
  mode: "inner" | "outer" = "inner"
): string | null {
  const complete = /<html[\s>]/i.test(html);
  const tree = (complete ? parse(html, { sourceCodeLocationInfo: true }) : parseFragment(html, { sourceCodeLocationInfo: true })) as LocatedNode;
  const body = complete ? children(children(tree).find((node) => node.tagName === "html") ?? tree).find((node) => node.tagName === "body") : tree;
  if (!body) return null;
  let node = body;
  for (const index of elementPath) {
    node = children(node)[index];
    if (!node) return null;
  }
  const loc = node.sourceCodeLocation;
  if (!loc) return null;
  const start = mode === "outer" ? loc.startOffset : loc.startTag?.endOffset;
  const end = mode === "outer" ? loc.endOffset : loc.endTag?.startOffset;
  if (start === undefined || end === undefined || end < start) return null;
  return html.slice(0, start) + replacement + html.slice(end);
}

export function readDesignMaxPages(html: string): number | null {
  const meta = html.match(/<meta\s+[^>]*name=["']smart-notes-max-pages["'][^>]*>/i)?.[0];
  const value = meta?.match(/\bcontent=["'](\d+)["']/i)?.[1];
  const parsed = value ? Number(value) : null;
  return parsed && parsed > 0 && parsed <= 100 ? parsed : null;
}

export function setDesignMaxPages(html: string, maxPages: number | null): string {
  const metaPattern = /<meta\s+[^>]*name=["']smart-notes-max-pages["'][^>]*>/i;
  const without = html.replace(metaPattern, "");
  if (maxPages === null) return without;
  const meta = `<meta name="smart-notes-max-pages" content="${maxPages}">`;
  if (/<\/head>/i.test(without)) return without.replace(/<\/head>/i, `${meta}</head>`);
  return meta + without;
}
