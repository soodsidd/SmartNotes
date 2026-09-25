import type { Node as PMNode } from "@tiptap/pm/model";

export interface CollapsibleHeadingSection {
  key: string;
  level: 1 | 2 | 3;
  title: string;
  headingOrder: number;
  startIndex: number;
  contentStartIndex: number;
  endIndex: number;
  hasCollapsibleContent: boolean;
}

export interface VerticalRange {
  minY: number;
  maxY: number;
}

function buildHeadingSectionKey(
  pagePath: string | null | undefined,
  headingOrder: number,
  level: number
) {
  return `${pagePath ?? "__page__"}::${headingOrder}::h${level}`;
}

function isCollapsibleHeading(node: PMNode): node is PMNode & {
  attrs: { level: 1 | 2 | 3 };
} {
  return (
    node.type.name === "heading" &&
    (node.attrs.level === 1 || node.attrs.level === 2 || node.attrs.level === 3)
  );
}

export function collectCollapsibleHeadingSections(
  doc: PMNode,
  pagePath?: string | null
): CollapsibleHeadingSection[] {
  const topLevelNodes = Array.from({ length: doc.childCount }, (_, index) => doc.child(index));
  const sections: CollapsibleHeadingSection[] = [];
  let headingOrder = 0;

  topLevelNodes.forEach((node, index) => {
    if (!isCollapsibleHeading(node)) {
      return;
    }

    let endIndex = topLevelNodes.length;
    for (let nextIndex = index + 1; nextIndex < topLevelNodes.length; nextIndex += 1) {
      const nextNode = topLevelNodes[nextIndex];
      if (isCollapsibleHeading(nextNode) && nextNode.attrs.level <= node.attrs.level) {
        endIndex = nextIndex;
        break;
      }
    }

    const title = node.textContent.trim() || "Untitled section";
    sections.push({
      key: buildHeadingSectionKey(pagePath, headingOrder, node.attrs.level),
      level: node.attrs.level,
      title,
      headingOrder,
      startIndex: index,
      contentStartIndex: index + 1,
      endIndex,
      hasCollapsibleContent: endIndex > index + 1,
    });
    headingOrder += 1;
  });

  return sections;
}

function collectShapeRelativePoints(
  value: unknown,
  points: Array<{ x: number; y: number }>
) {
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectShapeRelativePoints(entry, points);
    }
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  const record = value as Record<string, unknown>;
  const x = typeof record.x === "number" ? record.x : null;
  const y = typeof record.y === "number" ? record.y : null;
  if (x !== null && y !== null) {
    points.push({ x, y });
  }

  const width = typeof record.w === "number" ? record.w : null;
  const height = typeof record.h === "number" ? record.h : null;
  if (width !== null && height !== null) {
    points.push({ x: width, y: height });
  } else if (height !== null) {
    points.push({ x: 0, y: height });
  }

  for (const nested of Object.values(record)) {
    collectShapeRelativePoints(nested, points);
  }
}

export function extractAnnotationVerticalRanges(snapshot: unknown): VerticalRange[] {
  const store = (snapshot as { document?: { store?: Record<string, unknown> } } | null)?.document
    ?.store;
  if (!store) {
    return [];
  }

  return Object.values(store).flatMap((record) => {
    if (!record || typeof record !== "object") {
      return [];
    }

    const shape = record as Record<string, unknown>;
    if (shape.typeName !== "shape") {
      return [];
    }

    const baseY = typeof shape.y === "number" ? shape.y : 0;
    const relativePoints: Array<{ x: number; y: number }> = [{ x: 0, y: 0 }];
    collectShapeRelativePoints(shape.props, relativePoints);

    const yValues = relativePoints.map((point) => baseY + point.y);
    return [
      {
        minY: Math.min(...yValues),
        maxY: Math.max(...yValues),
      },
    ];
  });
}

function verticalRangesOverlap(
  top: number,
  bottom: number,
  range: VerticalRange
) {
  return range.maxY > top && range.minY < bottom;
}

export function sectionCollapseBlockedByInk(
  contentTop: number,
  contentBottom: number,
  inkRanges: VerticalRange[]
) {
  if (contentBottom <= contentTop) {
    return false;
  }

  return inkRanges.some((range) => verticalRangesOverlap(contentTop, contentBottom, range));
}
