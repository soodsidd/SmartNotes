"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Check, Download } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { AppPageView } from "@/components/app-page-view";
import { normalizeVaultRelativePagePath } from "@/lib/app-frame";
import { fetchPage } from "@/lib/api/pages";
import {
  getDeferredInstallPrompt,
  getPwaInstallState,
  isStandaloneDisplay,
  PWA_INSTALL_PROMPT_EVENT,
} from "@/lib/pwa-install";

/**
 * Add-to-home-screen affordance for the focused App shell (SN-187). When Chrome
 * has captured a `beforeinstallprompt` for this page's pinned manifest, clicking
 * installs a dedicated mini-app whose start_url opens straight into this App.
 * Other browsers (iOS Safari) get a short instruction toast instead. Mirrors the
 * log shell's InstallLogButton so both focus surfaces share one install contract.
 */
function InstallAppButton({ title }: { title: string }) {
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
      <span className="flex items-center gap-1 text-xs text-muted-foreground" data-testid="app-install-installed">
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
    <Button variant="outline" size="sm" data-testid="app-install" onClick={() => void onClick()}>
      <Download className="size-3.5" />
      Add to Home screen
    </Button>
  );
}

/**
 * Page-focused entry path for App pages (SN-187): the running App companion with
 * no developer chrome (no Develop toggle, Data/Source tabs, or notebook tree),
 * plus a back link and an Add-to-Home-screen button, sized full-height (`100dvh`)
 * for mobile. This is the `start_url` target that a per-page installed shortcut
 * opens. Drafts reuse the SN-183 App outbox (page-scoped), so accepted entries
 * survive reload from the installed icon. Sandbox authority is unchanged.
 */
export function FocusedAppShell({
  pagePath,
  title,
  bodyHtml,
}: {
  pagePath: string;
  title: string;
  bodyHtml: string;
}) {
  // SN-205: from a focused/installed App, openPage leaves focus mode and deep-links
  // into the main notebook at the validated target page (rather than merely
  // returning to the previously active page). Shape is validated locally; existence
  // is confirmed via the page API before we navigate so a missing/moved/external
  // target fails safely with an app-visible error and no navigation occurs.
  const handleOpenPage = React.useCallback(
    async (target: string): Promise<{ ok: boolean; error?: string }> => {
      const normalized = normalizeVaultRelativePagePath(target);
      if (!normalized) {
        return { ok: false, error: "That is not a valid Smart Notes page path." };
      }
      try {
        await fetchPage(normalized);
      } catch {
        return { ok: false, error: "That Smart Notes page could not be found." };
      }
      window.location.assign(`/?page=${encodeURIComponent(normalized)}`);
      return { ok: true };
    },
    []
  );

  return (
    <div className="flex h-[100dvh] w-full flex-col bg-background text-foreground" data-testid="focused-app-shell">
      <AppPageView
        pagePath={pagePath}
        title={title}
        bodyHtml={bodyHtml}
        onOpenPage={handleOpenPage}
        chromeless
        leading={
          <Link
            href="/"
            data-testid="app-focused-back"
            className="flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground transition hover:bg-surface hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Back to notebook"
          >
            <ArrowLeft className="size-4" />
          </Link>
        }
        trailing={<InstallAppButton title={title} />}
      />
    </div>
  );
}

export default FocusedAppShell;
