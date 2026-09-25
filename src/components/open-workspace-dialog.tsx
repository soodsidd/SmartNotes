"use client";

import * as React from "react";
import { AlertTriangle, FolderOpen, LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { pickNativeFolder } from "@/lib/api/fs-native";
import {
  fetchJupyterWorkspaceSessionStatus,
  type WorkspaceAccessMode,
} from "@/lib/api/jupyter";
import {
  workspaceDisplayNameFromPath,
  type DeepWorkDescriptor,
} from "@/lib/deep-work";

interface PendingDefaultBranch {
  path: string;
  branch?: string;
  projectName: string;
}

export interface OpenWorkspaceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenWorkspace: (workspace: DeepWorkDescriptor) => void;
}

export function OpenWorkspaceDialog({
  open,
  onOpenChange,
  onOpenWorkspace,
}: OpenWorkspaceDialogProps) {
  const [folderPath, setFolderPath] = React.useState("");
  const [busy, setBusy] = React.useState<"picker" | "validate" | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pendingDefaultBranch, setPendingDefaultBranch] = React.useState<PendingDefaultBranch | null>(null);

  React.useEffect(() => {
    if (!open) {
      setBusy(null);
      setError(null);
      setPendingDefaultBranch(null);
    }
  }, [open]);

  const chooseFolder = async () => {
    setBusy("picker");
    setError(null);
    setPendingDefaultBranch(null);
    try {
      const result = await pickNativeFolder({
        initialPath: folderPath || undefined,
        title: "Open a Deep Work workspace",
      });
      if (!result.cancelled && result.path) setFolderPath(result.path);
    } catch (pickerError) {
      setError(
        `${pickerError instanceof Error ? pickerError.message : "The folder picker is unavailable."} You can paste an absolute path instead.`
      );
    } finally {
      setBusy(null);
    }
  };

  const completeOpen = (
    pending: PendingDefaultBranch,
    accessMode: WorkspaceAccessMode,
    defaultBranchEditConfirmed = false
  ) => {
    onOpenWorkspace({
      rootPath: pending.path,
      projectName: pending.projectName,
      branch: pending.branch,
      worktreeLabel: pending.branch,
      requestedAccess: accessMode,
      ownerOpen: true,
      defaultBranchEditConfirmed: defaultBranchEditConfirmed || undefined,
    });
    onOpenChange(false);
  };

  const validateAndOpen = async (event: React.FormEvent) => {
    event.preventDefault();
    const path = folderPath.trim();
    if (!path) {
      setError("Choose a folder or paste its absolute path.");
      return;
    }

    setBusy("validate");
    setError(null);
    setPendingDefaultBranch(null);
    const pending = {
      path,
      projectName: workspaceDisplayNameFromPath(path),
    };
    try {
      const status = await fetchJupyterWorkspaceSessionStatus({
        rootPath: path,
        requestedAccess: "editable",
        ownerOpen: true,
      });
      const checked = { ...pending, branch: status.branch };
      if ((status.resolvedAccessMode ?? status.accessMode) === "read-only") {
        setPendingDefaultBranch(checked);
      } else {
        completeOpen(checked, "editable");
      }
    } catch (validationError) {
      setError(validationError instanceof Error ? validationError.message : "The workspace could not be opened.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-testid="open-workspace-dialog" showCloseButton={false}>
        <form onSubmit={validateAndOpen} className="contents">
          <DialogHeader>
            <DialogTitle>Open workspace</DialogTitle>
            <DialogDescription>
              Open a folder in place with JupyterLab. Smart Notes does not copy it into the vault.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <label className="space-y-1.5 text-sm font-medium" htmlFor="deep-work-folder-path">
              <span>Absolute folder path</span>
              <Input
                id="deep-work-folder-path"
                value={folderPath}
                onChange={(event) => {
                  setFolderPath(event.target.value);
                  setError(null);
                  setPendingDefaultBranch(null);
                }}
                placeholder="C:\\Projects\\worktrees\\my-workspace"
                className="font-mono"
                autoComplete="off"
                spellCheck={false}
                aria-describedby="deep-work-folder-help"
                aria-invalid={Boolean(error)}
                autoFocus
              />
            </label>
            <p id="deep-work-folder-help" className="text-xs text-muted-foreground">
              The path must be absolute and point to an existing folder.
            </p>
            <Button
              type="button"
              variant="outline"
              className="min-h-11 w-full justify-center sm:min-h-8"
              onClick={() => void chooseFolder()}
              disabled={busy !== null}
              data-testid="open-workspace-pick-folder"
            >
              {busy === "picker" ? <LoaderCircle className="animate-spin" /> : <FolderOpen />}
              Choose folder
            </Button>

            {pendingDefaultBranch ? (
              <div
                role="alert"
                className="space-y-3 rounded-lg border border-border bg-muted/50 p-3"
                data-testid="open-workspace-default-branch-warning"
              >
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
                  <p className="text-sm text-foreground">
                    {pendingDefaultBranch.branch ? `“${pendingDefaultBranch.branch}” is the default branch. ` : "This folder uses the default branch. "}
                    Open read-only, or explicitly unlock editing for this workspace.
                  </p>
                </div>
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => completeOpen(pendingDefaultBranch, "read-only")}
                  >
                    Open read-only
                  </Button>
                  <Button
                    type="button"
                    onClick={() => completeOpen(pendingDefaultBranch, "editable", true)}
                    data-testid="open-workspace-unlock-editing"
                  >
                    Unlock editing
                  </Button>
                </div>
              </div>
            ) : null}

            {error ? (
              <p role="alert" className="text-sm text-destructive" data-testid="open-workspace-error">
                {error}
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy !== null || Boolean(pendingDefaultBranch)}>
              {busy === "validate" ? <LoaderCircle className="animate-spin" /> : <FolderOpen />}
              Open workspace
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
