import { notFound } from "next/navigation";
import { PageRenderView } from "@/components/page-render-view";
import { verifyRenderToken } from "@/server/vault/page-render-token";
import { readAnnotationsScene, readPage } from "@/server/vault/pages";

export const dynamic = "force-dynamic";

export default async function RenderPage({
  searchParams,
}: {
  searchParams: { path?: string; token?: string };
}) {
  const pagePath = searchParams.path?.trim();
  const token = searchParams.token?.trim();
  if (!pagePath || !token || !verifyRenderToken(pagePath, token)) {
    notFound();
  }

  const page = await readPage(pagePath);
  const { scene, drawableBottom } = await readAnnotationsScene(pagePath);

  return (
    <PageRenderView
      pagePath={page.path}
      title={page.title}
      bodyHtml={page.body}
      annotationsScene={scene}
      drawableBottom={drawableBottom}
    />
  );
}
