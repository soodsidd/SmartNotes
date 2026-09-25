"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Download, Check } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { LogPageView } from "@/components/log-page-view";
import {
  getDeferredInstallPrompt,
  getPwaInstallState,
  isStandaloneDisplay,
  PWA_INSTALL_PROMPT_EVENT,
} from "@/lib/pwa-install";

export interface FocusedLogShellProps {
  pagePath: string;
  title: string;
  initialTab?: "form" | "history" | "table" | "source";
  initialViewId?: string | null;
}

/**
 * Add-to-home-screen affordance for the focused log shell. When Chrome has
 * captured a `beforeinstallprompt` for this page's pinned manifest, clicking
 * installs a dedicated mini-app whose start_url opens straight into this log.
 * Other browsers (iOS Safari) get a short instruction toast instead.
 */
function InstallLogButton({ title }: { title: string }) {
  const [installState, setInstallState] = React.useState<"installed" | "available" | "unavailable">(
    "unavailable"
  );

  React.useEffect(() => {
    const sync = () => setInstallState(getPwaInstallState());
    sync();
    window.addEventListener(PWA_INSTALL_PROMPT_EVENT, sync);
    const standaloneMedia =
      typeof window.matchMedia === "function" ? window.matchMedia("(display-mode: standalone)") : null;
    standaloneMedia?.addEventListener?.("change", sync);
    return () => {
      window.removeEventListener(PWA_INSTALL_PROMPT_EVENT, sync);
      standaloneMedia?.removeEventListener?.("change", sync);
    };
  }, []);

  if (isStandaloneDisplay() || installState === "installed") {
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground" data-testid="log-install-installed">
        <Check className="size-3.5" />
        Installed
      </span>
    );
  }

  const onClick = async () => {
    const prompt = getDeferredInstallPrompt();
    if (prompt) {
      try {
        await prompt.prompt();
      } catch {
        toast.error("Install was dismissed");
      }
      return;
    }
    toast.info(`To install “${title}”, use your browser menu → Add to Home screen.`);
  };

  return (
    <Button variant="outline" size="sm" data-testid="log-install" onClick={() => void onClick()}>
      <Download className="size-3.5" />
      Add to Home screen
    </Button>
  );
}

/**
 * Page-focused entry path (SN-144): a minimal Form | History | Table | Source shell with no
 * notebook tree or editor chrome, sized for quick mobile use. This is the
 * `start_url` target that a per-page installed shortcut opens.
 */
export function FocusedLogShell({
  pagePath,
  title,
  initialTab,
  initialViewId,
}: FocusedLogShellProps) {
  return (
    <div className="flex h-[100dvh] w-full flex-col bg-background">
      <LogPageView
        pagePath={pagePath}
        title={title}
        focusedLocalFirst
        initialTab={initialTab}
        initialViewId={initialViewId}
        leading={
          <Link
            href="/"
            data-testid="log-focused-back"
            className="flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground transition hover:bg-surface hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Back to notebook"
          >
            <ArrowLeft className="size-4" />
          </Link>
        }
        trailing={<InstallLogButton title={title} />}
        className="flex-1"
      />
    </div>
  );
}

export default FocusedLogShell;
