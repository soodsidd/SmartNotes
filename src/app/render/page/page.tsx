import { notFound } from "next/navigation";
import { PageRenderView } from "@/components/page-render-view";
import { verifyRenderToken } from "@/server/vault/page-render-token";
import { readAnnotationsScene, readPage } from "@/server/vault/pages";
import { isInkEngineAvailable, DEFAULT_INK_ENGINE } from "@/lib/ink-engine-preference";

export const dynamic = "force-dynamic";

export default async function RenderPage({
  searchParams,
}: {
  searchParams: { path?: string; token?: string; engine?: string };
}) {
  const pagePath = searchParams.path?.trim();
  const token = searchParams.token?.trim();
  if (!pagePath || !token || !verifyRenderToken(pagePath, token)) {
    notFound();
  }

  const page = await readPage(pagePath);
  const inkEngine = isInkEngineAvailable(searchParams.engine) ? searchParams.engine : DEFAULT_INK_ENGINE;
  const { scene, drawableBottom } = await readAnnotationsScene(pagePath, inkEngine);

  return (
    <PageRenderView
      pagePath={page.path}
      title={page.title}
      bodyHtml={page.body}
      inkEngine={inkEngine}
      annotationsScene={scene}
      drawableBottom={drawableBottom}
    />
  );
}
