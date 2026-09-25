export const ANNOTATION_DEBUG_PREFIX = "[SN-55 annotations]";

export function isAnnotationDebugEnabled(): boolean {
  return process.env.NEXT_PUBLIC_SN55_ANNOTATION_DEBUG === "1";
}

export function logAnnotationDebug(
  event: string,
  fields: Record<string, unknown> = {}
): void {
  if (!isAnnotationDebugEnabled()) return;
  console.debug(ANNOTATION_DEBUG_PREFIX, event, fields);
}

export function countAnnotationShapes(snapshot: unknown): number {
  const store = (snapshot as { document?: { store?: Record<string, unknown> } } | null)?.document
    ?.store;
  if (!store) return 0;
  return Object.values(store).filter(
    (record) =>
      record &&
      typeof record === "object" &&
      "typeName" in record &&
      (record as { typeName?: string }).typeName === "shape"
  ).length;
}
