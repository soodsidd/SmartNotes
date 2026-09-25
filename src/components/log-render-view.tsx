"use client";

import * as React from "react";
import { LogPageView } from "@/components/log-page-view";

/** Minimal, token-protected render surface for companion form review. */
export function LogRenderView({ pagePath, title }: { pagePath: string; title: string }) {
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    const timer = window.setTimeout(() => setReady(true), 0);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <main
      data-testid="log-render-root"
      data-log-render-ready={ready ? "true" : undefined}
      className="min-h-screen bg-background text-foreground"
    >
      <LogPageView pagePath={pagePath} title={title} className="min-h-screen" />
    </main>
  );
}
