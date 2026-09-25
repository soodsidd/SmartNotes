"use client";

import * as React from "react";
import {
  ArrowLeft,
  Check,
  CircleAlert,
  Ellipsis,
  FileCode2,
  GitBranch,
  LockKeyhole,
  MessageSquareText,
  PanelBottom,
  RefreshCw,
  Settings2,
  SquareTerminal,
  UnlockKeyhole,
  WandSparkles,
} from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { JupyterDeepWorkCommand, JupyterFocusState } from "@/lib/jupyter-focus";
import type { JupyterSessionStatus, WorkspaceAccessMode } from "@/lib/api/jupyter";
import { cn } from "@/lib/utils";

export interface JupyterDeepWorkIdentity {
  projectName: string;
  branch?: string;
  worktreeLabel?: string;
  accessMode: WorkspaceAccessMode;
}

export interface JupyterToolbarCommandState {
  pending: JupyterDeepWorkCommand | null;
  failed: JupyterDeepWorkCommand | null;
  error?: string;
}

export interface JupyterDeepWorkToolbarProps {
  title?: string;
  identity?: JupyterDeepWorkIdentity;
  focus: JupyterFocusState | null;
  sessionStatus: JupyterSessionStatus;
  commandState: JupyterToolbarCommandState;
  onCommand: (command: JupyterDeepWorkCommand) => void;
  onOpenSidebar?: () => void;
  onBack?: () => void;
  backLabel?: string;
  onReloadLab?: () => void;
  onStopWorkspace?: () => void;
  onRevealFolder?: () => void;
  onViewDiff?: () => void;
  onAnnotations?: () => void;
  annotationCount?: number;
  annotationsDisabledReason?: string;
}

function ToolbarButton({
  label,
  children,
  className,
  variant = "ghost",
  size = "icon-sm",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  variant?: "default" | "outline" | "secondary" | "ghost" | "destructive" | "link";
  size?: "default" | "xs" | "sm" | "lg" | "icon" | "icon-xs" | "icon-sm" | "icon-lg";
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={label}
            {...props}
            className={buttonVariants({ variant, size, className: cn("h-11 md:h-7", className) })}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function JupyterDeepWorkToolbar({
  title,
  identity,
  focus,
  sessionStatus,
  commandState,
  onCommand,
  onOpenSidebar,
  onBack,
  backLabel,
  onReloadLab,
  onStopWorkspace,
  onRevealFolder,
  onViewDiff,
  onAnnotations,
  annotationCount = 0,
  annotationsDisabledReason,
}: JupyterDeepWorkToolbarProps) {
  const readOnly = identity?.accessMode === "read-only";
  const hasSelection = Boolean(
    focus?.selection && focus.selection.start.offset !== focus.selection.end.offset
  );
  const ready = sessionStatus === "ready";
  const fileStatus = focus?.isDirty
    ? "Dirty"
    : focus?.isDirty === false
      ? "Saved"
      : "No document selected";
  const currentFile = focus?.workspacePath || (ready ? "No file selected" : "Waiting for JupyterLab");

  const dispatch = (command: JupyterDeepWorkCommand) => onCommand(command);

  return (
    <TooltipProvider>
      <header
        data-testid="jupyter-deep-work-toolbar"
        className="flex min-h-12 shrink-0 items-center gap-1 border-b border-border bg-background px-1.5 text-foreground md:min-h-10 md:gap-1.5 md:px-2"
      >
        {onBack ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-11 px-2 md:h-7"
            onClick={onBack}
            data-testid={identity ? "jupyter-toolbar-return" : "jupyter-toolbar-back"}
            aria-label={backLabel ?? "Back"}
          >
            <ArrowLeft className="size-4" />
            <span className="sr-only sm:not-sr-only sm:max-w-28 sm:truncate md:max-w-none">
              {backLabel ?? "Back"}
            </span>
          </Button>
        ) : (
          <ToolbarButton
            label={backLabel ?? (onBack ? "Back" : "Open notebook sidebar")}
            variant="ghost"
            size="icon-sm"
            onClick={onBack ?? onOpenSidebar}
            data-testid="jupyter-toolbar-back"
          >
            <ArrowLeft className="size-4" />
          </ToolbarButton>
        )}

        <div className="flex min-w-0 max-w-28 items-center gap-1.5 border-r border-border pr-1.5 sm:max-w-48 sm:pr-2 md:max-w-64">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-xs font-semibold">
                {identity?.projectName || title || "JupyterLab"}
              </span>
              {identity?.branch ? (
                <span className="flex min-w-0 max-w-20 items-center gap-1 truncate rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-secondary-foreground sm:max-w-28 lg:max-w-36">
                  <GitBranch className="hidden size-3 sm:block" />
                  <span className="truncate">{identity.worktreeLabel || identity.branch}</span>
                </span>
              ) : null}
            </div>
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
              {readOnly ? <LockKeyhole className="size-3" /> : <UnlockKeyhole className="size-3" />}
              <span>{readOnly ? "Read-only" : "Editable"}</span>
            </div>
          </div>
        </div>

        <div
          className="flex min-w-0 flex-1 flex-col justify-center px-1"
          title={`${currentFile} · ${fileStatus}`}
        >
          <div className="flex min-w-0 items-center gap-1.5">
            <FileCode2 className="hidden size-3.5 shrink-0 text-muted-foreground sm:block" />
            <span className="min-w-0 truncate font-mono text-[11px]">{currentFile}</span>
          </div>
          <span
            aria-live="polite"
            className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground"
          >
            {focus?.isDirty ? (
              <span className="size-1.5 rounded-full bg-accent" />
            ) : focus?.isDirty === false ? (
              <Check className="size-3" />
            ) : null}
            {fileStatus}
          </span>
        </div>

        {identity ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-11 px-2 md:h-7"
            disabled={!onAnnotations}
            title={annotationsDisabledReason}
            onClick={onAnnotations}
            data-testid="jupyter-toolbar-annotations"
          >
            <MessageSquareText className="size-4" />
            <span className="hidden lg:inline">Annotations{annotationCount ? ` (${annotationCount})` : ""}</span>
            <span className="sr-only lg:hidden">Source annotations</span>
          </Button>
        ) : null}

        <DropdownMenu>
          <DropdownMenuTrigger
            type="button"
            className={buttonVariants({ variant: "ghost", size: "icon-sm", className: "size-11 md:size-7" })}
            aria-label="More Deep Work actions"
            data-testid="jupyter-toolbar-overflow"
          >
            <Ellipsis className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuGroup>
              <DropdownMenuLabel>
                {focus?.documentKind === "notebook" ? "Notebook" : focus?.documentKind === "file" ? "Source file" : "Workspace"}
              </DropdownMenuLabel>
              {focus?.documentKind === "file" ? (
                <>
                  <DropdownMenuItem disabled={readOnly || Boolean(commandState.pending)} onClick={() => dispatch("format-document")}>
                    <WandSparkles /> Format document
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={readOnly || !hasSelection || Boolean(commandState.pending)} onClick={() => dispatch("format-selection")}>
                    <WandSparkles /> Format selection
                  </DropdownMenuItem>
                  {onViewDiff ? (
                    <>
                      <DropdownMenuItem onClick={onViewDiff}>
                        <GitBranch /> View diff in Ascent Vector
                      </DropdownMenuItem>
                      {onBack ? (
                        <DropdownMenuItem onClick={onBack}>
                          <ArrowLeft /> Return to Ascent Vector
                        </DropdownMenuItem>
                      ) : null}
                    </>
                  ) : null}
                </>
              ) : null}
              {focus?.documentKind === "notebook" ? (
                <>
                  <DropdownMenuItem disabled={Boolean(commandState.pending)} onClick={() => dispatch("interrupt-kernel")}><CircleAlert /> Interrupt kernel</DropdownMenuItem>
                  <DropdownMenuItem disabled={Boolean(commandState.pending)} onClick={() => dispatch("restart-kernel")}><RefreshCw /> Restart kernel</DropdownMenuItem>
                  <DropdownMenuItem disabled={Boolean(commandState.pending)} onClick={() => dispatch("select-kernel")}><Settings2 /> Select kernel</DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={!ready || readOnly || Boolean(commandState.pending)} onClick={() => dispatch("open-terminal")}>
              <SquareTerminal /> Terminal
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!ready || Boolean(commandState.pending)} onClick={() => dispatch("reload-files")}>
              <RefreshCw /> Reload files
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!ready || Boolean(commandState.pending)} onClick={() => dispatch("manage-kernels")}>
              <PanelBottom /> Kernels & environments
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!ready || Boolean(commandState.pending)} onClick={() => dispatch("open-settings")}>
              <Settings2 /> Theme, fonts & shortcuts
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!onRevealFolder} onClick={onRevealFolder}>
              <FileCode2 /> Reveal workspace folder
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!onReloadLab} onClick={onReloadLab}>
              <RefreshCw /> Reload JupyterLab
            </DropdownMenuItem>
            {onStopWorkspace ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={onStopWorkspace}>
                  <CircleAlert /> Stop workspace
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </header>
      {commandState.error ? (
        <div role="status" data-testid="jupyter-toolbar-error" className="shrink-0 border-b border-destructive/30 bg-destructive/10 px-3 py-1 text-xs text-destructive">
          {commandState.error}
        </div>
      ) : null}
    </TooltipProvider>
  );
}
