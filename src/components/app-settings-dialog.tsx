"use client";

import * as React from "react";
import { Download, MoonStar, RotateCw, ServerOff, Settings, Smartphone, SunMedium } from "lucide-react";
import { BackupSettingsPanel } from "@/components/backup-settings-panel";
import { IngestDestinationsSettingsPanel } from "@/components/ingest-destinations-settings-panel";
import { NotebookRegistryPanel } from "@/components/notebook-registry-panel";
import type { PortableNotebookRecord } from "@/lib/api/notebook-registry";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useDensity, type Density } from "@/components/density-provider";
import { useSpellcheck } from "@/components/spellcheck-provider";
import { useTheme } from "@/components/theme-provider";
import {
  PWA_INSTALL_PROMPT_EVENT,
  clearDeferredInstallPrompt,
  getDeferredInstallPrompt,
  getPwaInstallState,
} from "@/lib/pwa-install";
import { cn } from "@/lib/utils";
import { DENSITY_OPTIONS, KEYBOARD_SHORTCUTS } from "@/lib/app-settings";
import {
  fetchJupyterProfileStatus,
  stopAllJupyterSessions,
  type JupyterProfileStatus,
} from "@/lib/api/jupyter";
import { triggerForceReload } from "@/lib/sw-update";

type SettingsTab = "general" | "notebooks" | "backups" | "ingest";

const SETTINGS_TABS: { id: SettingsTab; label: string }[] = [
  { id: "general", label: "General" },
  { id: "notebooks", label: "Notebooks" },
  { id: "backups", label: "Backups" },
  { id: "ingest", label: "Ingest" },
];

export function AppSettingsDialog({
  open,
  onOpenChange,
  onVaultRestored,
  onTreeRefresh,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onVaultRestored?: () => void | Promise<void>;
  onTreeRefresh?: (notebook?: PortableNotebookRecord) => void | Promise<void>;
}) {
  const { density, setDensity } = useDensity();
  const { spellcheckEnabled, setSpellcheckEnabled } = useSpellcheck();
  const { theme, setTheme } = useTheme();
  const [activeTab, setActiveTab] = React.useState<SettingsTab>("general");
  const [installState, setInstallState] = React.useState(() => getPwaInstallState());
  const [installing, setInstalling] = React.useState(false);
  const [reloadingApp, setReloadingApp] = React.useState(false);
  const [stoppingJupyter, setStoppingJupyter] = React.useState(false);
  const [jupyterStatus, setJupyterStatus] = React.useState<string | null>(null);
  const [jupyterError, setJupyterError] = React.useState<string | null>(null);
  const [jupyterProfile, setJupyterProfile] = React.useState<JupyterProfileStatus | null>(null);
  const [jupyterProfileError, setJupyterProfileError] = React.useState(false);

  const handleReloadApp = React.useCallback(() => {
    setReloadingApp(true);
    void triggerForceReload();
  }, []);

  const handleStopJupyter = React.useCallback(async () => {
    setStoppingJupyter(true);
    setJupyterStatus(null);
    setJupyterError(null);
    try {
      const result = await stopAllJupyterSessions();
      setJupyterStatus(
        result.stopped === 1
          ? "Stopped 1 JupyterLab server."
          : `Stopped ${result.stopped} JupyterLab servers.`
      );
    } catch (error) {
      setJupyterError(error instanceof Error ? error.message : "Failed to stop JupyterLab servers.");
    } finally {
      setStoppingJupyter(false);
    }
  }, []);

  React.useEffect(() => {
    const syncInstallState = () => setInstallState(getPwaInstallState());
    const standaloneMedia =
      typeof window.matchMedia === "function"
        ? window.matchMedia("(display-mode: standalone)")
        : null;

    syncInstallState();
    window.addEventListener(PWA_INSTALL_PROMPT_EVENT, syncInstallState);
    window.addEventListener("appinstalled", syncInstallState);
    standaloneMedia?.addEventListener?.("change", syncInstallState);

    return () => {
      window.removeEventListener(PWA_INSTALL_PROMPT_EVENT, syncInstallState);
      window.removeEventListener("appinstalled", syncInstallState);
      standaloneMedia?.removeEventListener?.("change", syncInstallState);
    };
  }, []);

  React.useEffect(() => {
    if (!open || activeTab !== "general") return;
    let cancelled = false;
    setJupyterProfileError(false);
    void fetchJupyterProfileStatus()
      .then((status) => {
        if (!cancelled) setJupyterProfile(status);
      })
      .catch(() => {
        if (!cancelled) setJupyterProfileError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab, open]);

  const handleInstall = React.useCallback(async () => {
    const promptEvent = getDeferredInstallPrompt();
    if (!promptEvent) {
      setInstallState(getPwaInstallState());
      return;
    }

    setInstalling(true);

    try {
      await promptEvent.prompt();
      await promptEvent.userChoice?.catch(() => undefined);
    } finally {
      clearDeferredInstallPrompt();
      setInstallState(getPwaInstallState());
      setInstalling(false);
    }
  }, []);

  const installLabel =
    installState === "installed"
      ? "Installed"
      : installState === "available"
        ? "Install available"
        : "Browser shortcut only";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(88vh,720px)] w-full overflow-y-auto sm:max-w-lg" data-testid="app-settings-dialog">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            {activeTab === "backups"
              ? "Vault backup schedule, retention, and restore."
              : activeTab === "notebooks"
                ? "Open external notebook directories alongside the primary vault."
                : activeTab === "ingest"
                  ? "Notebooks external senders may capture into over the ingest API."
                  : "Reading size, spellcheck, appearance, and keyboard shortcuts."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-1.5 border-b border-border/80 pb-3">
          {SETTINGS_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              data-testid={`settings-tab-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "rounded border px-3 py-1.5 text-xs transition-colors",
                activeTab === tab.id
                  ? "border-[color:var(--accent)] bg-[color:var(--accent)]/12 text-foreground"
                  : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === "backups" ? (
          <BackupSettingsPanel
            onVaultRestored={async () => {
              await onVaultRestored?.();
              onOpenChange(false);
            }}
          />
        ) : activeTab === "notebooks" ? (
          <NotebookRegistryPanel
            onTreeRefresh={async (notebook) => {
              await onTreeRefresh?.(notebook);
            }}
          />
        ) : activeTab === "ingest" ? (
          <IngestDestinationsSettingsPanel />
        ) : (
          <div className="space-y-5 pt-1">
            <section>
              <p className="mb-2 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Font size</p>
              <div className="flex flex-wrap gap-1.5">
                {DENSITY_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    data-testid={`settings-density-${option.value}`}
                    onClick={() => setDensity(option.value)}
                    className={cn(
                      "rounded border px-3 py-1.5 text-xs transition-colors",
                      density === option.value
                        ? "border-[color:var(--accent)] bg-[color:var(--accent)]/12 text-foreground"
                        : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </section>

            <section data-testid="settings-spellcheck">
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Spellcheck</p>
                <button
                  type="button"
                  role="switch"
                  aria-checked={spellcheckEnabled}
                  aria-label="Spellcheck"
                  data-testid="settings-spellcheck-toggle"
                  onClick={() => setSpellcheckEnabled(!spellcheckEnabled)}
                  className={cn(
                    "relative h-6 w-11 rounded-full border transition-colors",
                    spellcheckEnabled
                      ? "border-[color:var(--accent)] bg-[color:var(--accent)]"
                      : "border-border bg-muted"
                  )}
                >
                  <span
                    className={cn(
                      "absolute top-0.5 size-5 rounded-full bg-background shadow transition-transform",
                      spellcheckEnabled ? "translate-x-5" : "translate-x-0.5"
                    )}
                  />
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                Browser spelling underlines in the text editor. Off does not change note content.
              </p>
            </section>

            <section>
              <p className="mb-2 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Appearance</p>
              <div className="flex gap-1.5">
                <Button
                  type="button"
                  variant={theme === "light" ? "default" : "outline"}
                  size="sm"
                  data-testid="settings-theme-light"
                  onClick={() => setTheme("light")}
                  className="gap-1.5"
                >
                  <SunMedium className="size-3.5" />
                  Light
                </Button>
                <Button
                  type="button"
                  variant={theme === "dark" ? "default" : "outline"}
                  size="sm"
                  data-testid="settings-theme-dark"
                  onClick={() => setTheme("dark")}
                  className="gap-1.5"
                >
                  <MoonStar className="size-3.5" />
                  Dark
                </Button>
              </div>
            </section>

            <section>
              <p className="mb-2 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Keyboard shortcuts</p>
              <ul className="space-y-1.5 rounded-md border border-border/80 bg-muted/10 p-2.5">
                {KEYBOARD_SHORTCUTS.map((shortcut) => (
                  <li
                    key={shortcut.label}
                    className="flex items-center justify-between gap-3 text-xs"
                    data-testid={`settings-shortcut-${shortcut.label.toLowerCase().replace(/\s+/g, "-")}`}
                  >
                    <span className="text-foreground">{shortcut.label}</span>
                    <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                      {typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)
                        ? shortcut.macKeys
                        : shortcut.keys}
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            <section data-testid="settings-pwa-install">
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Install app</p>
                <span
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-[10px] font-medium tracking-[0.08em]",
                    installState === "installed"
                      ? "border-[color:var(--accent)] bg-[color:var(--accent)]/12 text-foreground"
                      : installState === "available"
                        ? "border-border bg-muted/40 text-foreground"
                        : "border-border bg-transparent text-muted-foreground"
                  )}
                  data-testid="settings-pwa-status"
                >
                  {installLabel}
                </span>
              </div>

              <div className="space-y-2 rounded-md border border-border/80 bg-muted/10 p-3">
                <p className="text-xs text-foreground">
                  {installState === "installed"
                    ? "This device is running the standalone app shell."
                    : installState === "available"
                      ? "Chrome sees this origin as installable. Use Install app for a standalone launch."
                      : "Chrome has not exposed PWA install yet, so Add to Home screen will behave like a browser shortcut."}
                </p>
                <p className="text-xs text-muted-foreground">
                  Use HTTPS with a trusted certificate or localhost. Plain LAN HTTP and many self-signed certificate flows will not qualify for Android app install.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={installState === "available" ? "default" : "outline"}
                    onClick={() => void handleInstall()}
                    disabled={installState !== "available" || installing}
                    data-testid="settings-pwa-install-button"
                    className="gap-1.5"
                  >
                    <Download className="size-3.5" />
                    {installing ? "Opening…" : "Install app"}
                  </Button>
                  <div className="inline-flex items-center gap-1.5 rounded-md border border-border/80 px-2.5 py-1 text-[11px] text-muted-foreground">
                    <Smartphone className="size-3.5" />
                    Android Chrome should show <span className="text-foreground">Install app</span>, not only <span className="text-foreground">Add to Home screen</span>.
                  </div>
                </div>
              </div>
            </section>

            <section data-testid="settings-reload-app">
              <p className="mb-2 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">App</p>
              <div className="space-y-4 rounded-md border border-border/80 bg-muted/10 p-3">
                <div className="space-y-2" data-testid="settings-jupyterlab-controls">
                  <div
                    className="rounded border border-border/70 bg-background/60 px-2.5 py-2 text-xs"
                    data-testid="settings-jupyter-profile-status"
                  >
                    <p className="font-medium text-foreground">Jupyter profile</p>
                    {jupyterProfile ? (
                      <p className="mt-1 text-muted-foreground">
                        JupyterLab {jupyterProfile.jupyterLabVersion ?? "not found"}
                        {jupyterProfile.source === "override" ? " (configured override)" : jupyterProfile.source === "profile" ? " (Smart Notes profile)" : jupyterProfile.source === "path" ? " (PATH fallback)" : ""}
                        {" · "}LSP {jupyterProfile.lspInstalled ? "installed" : "missing"}
                        {" · "}pylsp {jupyterProfile.pylspReachable ? "reachable" : "unreachable"}
                      </p>
                    ) : jupyterProfileError ? (
                      <p className="mt-1 text-muted-foreground">Profile status unavailable.</p>
                    ) : (
                      <p className="mt-1 text-muted-foreground">Checking profile…</p>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Stop local JupyterLab servers launched from notebook pages.
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void handleStopJupyter()}
                    disabled={stoppingJupyter}
                    data-testid="settings-stop-jupyterlab-button"
                    className="gap-1.5"
                  >
                    <ServerOff className={cn("size-3.5", stoppingJupyter && "animate-pulse")} />
                    {stoppingJupyter ? "Stopping…" : "Stop JupyterLab servers"}
                  </Button>
                  {jupyterStatus && (
                    <p className="text-xs text-muted-foreground" data-testid="settings-jupyterlab-status">
                      {jupyterStatus}
                    </p>
                  )}
                  {jupyterError && (
                    <p className="text-xs text-destructive" data-testid="settings-jupyterlab-error">
                      {jupyterError}
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  On a stale build? Reload clears the cached app shell and fetches the latest version from the network.
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={handleReloadApp}
                  disabled={reloadingApp}
                  data-testid="settings-reload-app-button"
                  className="gap-1.5"
                >
                  <RotateCw className={cn("size-3.5", reloadingApp && "animate-spin")} />
                  {reloadingApp ? "Reloading…" : "Reload app"}
                </Button>
                </div>
              </div>
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function AppSettingsTrigger({
  onClick,
}: {
  onClick: () => void;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={onClick}
      aria-label="Open settings"
      data-testid="app-settings-trigger"
    >
      <Settings className="size-4" />
    </Button>
  );
}
