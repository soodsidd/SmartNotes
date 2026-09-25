import { notFound } from "next/navigation";
import { UiRenderView } from "@/components/ui-render-view";
import { resolveUiViewportWidth } from "@/server/vault/page-render";
import { verifyRenderToken } from "@/server/vault/page-render-token";
import { readAnnotationsScene, readPage } from "@/server/vault/pages";

export const dynamic = "force-dynamic";

/**
 * Token-protected raw-HTML render surface for design pages (note_type=design, SN-167).
 * Renders the artifact body verbatim (bypassing Tiptap) at the requested viewport
 * width and composites the page's ink annotations for capture parity.
 */
export default async function RenderUiPage({
  searchParams,
}: {
  searchParams: { path?: string; token?: string; viewportWidth?: string };
}) {
  const pagePath = searchParams.path?.trim();
  const token = searchParams.token?.trim();
  if (!pagePath || !token || !verifyRenderToken(pagePath, token)) {
    notFound();
  }

  const page = await readPage(pagePath);
  if (page.metadata.note_type !== "design") {
    notFound();
  }

  const viewportWidth = resolveUiViewportWidth(
    searchParams.viewportWidth ? Number.parseInt(searchParams.viewportWidth, 10) : undefined
  );
  const { scene, drawableBottom } = await readAnnotationsScene(pagePath);

  return (
    <UiRenderView
      pagePath={page.path}
      title={page.title}
      bodyHtml={page.body}
      viewportWidth={viewportWidth}
      annotationsScene={scene}
      drawableBottom={drawableBottom}
    />
  );
}
