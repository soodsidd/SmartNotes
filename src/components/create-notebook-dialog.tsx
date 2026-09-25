"use client";

import * as React from "react";
import { FolderPlus, HardDrive, NotebookPen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RemoteNotebookForm } from "@/components/remote-notebook-dialog";
import type { PortableNotebookRecord } from "@/lib/api/notebook-registry";
import { cn } from "@/lib/utils";

type CreateNotebookStep = "choose" | "vault" | "remote";

export function CreateNotebookDialog({
  open,
  onOpenChange,
  onCreateVaultNotebook,
  onRemoteRegistered,
  isSubmitting = false,
  error,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreateVaultNotebook: (name: string) => void | Promise<void>;
  onRemoteRegistered?: (notebook: PortableNotebookRecord) => void | Promise<void>;
  isSubmitting?: boolean;
  error?: string | null;
}) {
  const [step, setStep] = React.useState<CreateNotebookStep>("choose");
  const [vaultName, setVaultName] = React.useState("");

  React.useEffect(() => {
    if (!open) {
      setStep("choose");
      setVaultName("");
    }
  }, [open]);

  const handleOpenChange = React.useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        setStep("choose");
        setVaultName("");
      }
      onOpenChange(nextOpen);
    },
    [onOpenChange]
  );

  const handleRemoteSuccess = React.useCallback(() => {
    handleOpenChange(false);
  }, [handleOpenChange]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="create-notebook-dialog">
        {step === "choose" ? (
          <>
            <DialogHeader>
              <DialogTitle>Create notebook</DialogTitle>
              <DialogDescription>
                Add a notebook to the local vault or register a folder on the Smart Notes backend host.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-2">
              <button
                type="button"
                className={cn(
                  "flex items-start gap-3 rounded-md border border-border px-3 py-3 text-left transition hover:bg-muted/40"
                )}
                onClick={() => setStep("vault")}
                data-testid="create-vault-notebook-option"
              >
                <NotebookPen className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <span>
                  <span className="block text-sm font-medium text-foreground">Vault notebook</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    Create inside the primary Smart Notes vault.
                  </span>
                </span>
              </button>
              <button
                type="button"
                className={cn(
                  "flex items-start gap-3 rounded-md border border-border px-3 py-3 text-left transition hover:bg-muted/40"
                )}
                onClick={() => setStep("remote")}
                data-testid="create-remote-notebook-option"
              >
                <HardDrive className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <span>
                  <span className="block text-sm font-medium text-foreground">Remote notebook</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    Choose or create a backend-host folder; phones use an in-app server browser.
                  </span>
                </span>
              </button>
            </div>
          </>
        ) : step === "vault" ? (
          <>
            <DialogHeader>
              <DialogTitle>Vault notebook</DialogTitle>
              <DialogDescription>Create a top-level notebook inside the primary vault.</DialogDescription>
            </DialogHeader>

            <Input
              value={vaultName}
              onChange={(event) => setVaultName(event.target.value)}
              placeholder="Research"
              autoFocus
              data-testid="create-vault-notebook-name-input"
            />

            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setStep("choose")} disabled={isSubmitting}>
                Back
              </Button>
              <Button
                type="button"
                onClick={() => void onCreateVaultNotebook(vaultName.trim())}
                disabled={isSubmitting || !vaultName.trim()}
                data-testid="create-vault-notebook-submit"
              >
                <FolderPlus className="size-4" />
                Create
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Remote notebook</DialogTitle>
              <DialogDescription>
                Register a notebook folder on the Smart Notes backend host. Desktop can use the Windows picker; phones use the in-app server-folder browser.
              </DialogDescription>
            </DialogHeader>

            <RemoteNotebookForm
              onCancel={() => setStep("choose")}
              onSuccess={handleRemoteSuccess}
              onRegistered={onRemoteRegistered}
            />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
