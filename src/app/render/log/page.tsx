import { notFound } from "next/navigation";
import { LogRenderView } from "@/components/log-render-view";
import { verifyRenderToken } from "@/server/vault/page-render-token";
import { readPage } from "@/server/vault/pages";

export const dynamic = "force-dynamic";

export default async function RenderLogPage({ searchParams }: { searchParams: { path?: string; token?: string } }) {
  const pagePath = searchParams.path?.trim();
  const token = searchParams.token?.trim();
  if (!pagePath || !token || !verifyRenderToken(pagePath, token)) notFound();

  const page = await readPage(pagePath);
  if (page.metadata.note_type !== "log") notFound();
  return <LogRenderView pagePath={page.path} title={page.title} />;
}
