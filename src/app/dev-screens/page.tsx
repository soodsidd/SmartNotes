import { notFound } from "next/navigation";
import { AiScreensShowcase } from "@/components/ai-screens-showcase";

export const dynamic = "force-dynamic";

export default function DevScreensPage({
  searchParams,
}: {
  searchParams?: { surface?: string };
}) {
  if (process.env.NODE_ENV === "production" && process.env.ENABLE_DEV_SCREENS !== "1") {
    notFound();
  }

  const surface = searchParams?.surface === "mobile" ? "mobile" : "desktop";
  return <AiScreensShowcase surface={surface} />;
}
