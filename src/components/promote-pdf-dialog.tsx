"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { availablePaperHomes, defaultPaperTitleFromPdfName } from "@/lib/paper-attach";
import type { VaultNotebook } from "@/lib/vault-contract";

const selectClass =
  "min-h-11 w-full rounded-md border border-input bg-background px-2 text-base text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring xl:min-h-8 xl:text-xs";

export interface PromotePdfDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tree: VaultNotebook[];
  fileName: string;
  href: string;
  defaultHomeNotebookPath: string;
  onConfirm: (input: {
    href: string;
    title: string;
    homeNotebookPath: string;
    replaceChip: boolean;
  }) => Promise<void>;
}

export function PromotePdfDialog({
  open,
  onOpenChange,
  tree,
  fileName,
  href,
  defaultHomeNotebookPath,
  onConfirm,
}: PromotePdfDialogProps) {
  const notebooks = availablePaperHomes(tree);
  const [title, setTitle] = React.useState(() => defaultPaperTitleFromPdfName(fileName));
  const [home, setHome] = React.useState(defaultHomeNotebookPath);
  const [replaceChip, setReplaceChip] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState("");
  const selectedHome = home || defaultHomeNotebookPath || notebooks[0]?.path || "";

  // Reset only when the dialog opens for a PDF. SN-366: `tree` is not a dependency — every vault
  // refresh (including the one the submit itself triggers) used to wipe the typed title and pending state.
  React.useEffect(() => {
    if (!open) return;
    setTitle(defaultPaperTitleFromPdfName(fileName));
    setHome(defaultHomeNotebookPath);
    setReplaceChip(false);
    setError("");
    setPending(false);
  }, [open, fileName, defaultHomeNotebookPath]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* SN-366: Save as paper opens over the PDF reader (--z-pdf-reader), so the dialog needs its own layer. */}
      <DialogContent
        className="z-[var(--z-reader-dialog)] w-[calc(100vw-2rem)] max-w-md gap-3 p-4 sm:p-6"
        overlayClassName="z-[var(--z-reader-dialog)]"
        data-testid="promote-pdf-dialog"
      >
        <DialogHeader>
          <DialogTitle>Promote to paper</DialogTitle>
          <DialogDescription>
            Creates a Bibliography paper and copies “{fileName}” onto it. The original PDF stays on this page unless you remove it.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={async (event) => {
            event.preventDefault();
            setPending(true);
            setError("");
            try {
              await onConfirm({ href, title, homeNotebookPath: selectedHome, replaceChip });
              onOpenChange(false);
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : "Could not promote PDF.");
            } finally {
              setPending(false);
            }
          }}
        >
          <label className="text-xs text-muted-foreground">
            Save paper in
            <select
              className={selectClass}
              value={selectedHome}
              onChange={(event) => setHome(event.target.value)}
              data-testid="promote-pdf-home"
            >
              {notebooks.map((entry) => (
                <option key={entry.path} value={entry.path}>
                  {entry.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-muted-foreground">
            Title
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              data-testid="promote-pdf-title"
            />
          </label>
          <label className="flex items-start gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-[var(--paper)]"
              checked={replaceChip}
              onChange={(event) => setReplaceChip(event.target.checked)}
              data-testid="promote-pdf-replace-chip"
            />
            <span>Remove the original PDF chip from this page after promoting</span>
          </label>
          {error ? (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          ) : null}
          <Button type="submit" className="justify-self-start" disabled={pending || !selectedHome || !title.trim()} data-testid="promote-pdf-submit">
            {pending ? "Promoting…" : "Create paper"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
