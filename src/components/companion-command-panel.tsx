"use client";

import * as React from "react";
import { Check, ChevronDown, ChevronRight, LoaderCircle, X } from "lucide-react";

import type { CompanionCommandEntry } from "@/lib/companion-command-activity";
import { cn } from "@/lib/utils";

/**
 * SN-401: read-only, live list of the shell commands Companion ran this
 * session. Observation only — no input, no re-run, no terminal.
 */
export function CompanionCommandPanel({
  commands,
  onClose,
  onClear,
}: {
  commands: readonly CompanionCommandEntry[];
  onClose?: () => void;
  onClear?: () => void;
}) {
  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set());
  const listRef = React.useRef<HTMLOListElement>(null);
  const lastKey = commands.at(-1)?.key;

  // Newest command stays in view while Companion works.
  React.useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [lastKey, commands.length]);

  const toggle = (key: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <section
      aria-label="Companion commands"
      data-testid="companion-command-panel"
      className="flex max-h-72 min-h-0 flex-col border-b border-border bg-surface"
    >
      <header className="flex items-center gap-2 px-3 py-1.5">
        <h2 className="text-xs font-semibold text-foreground">Companion commands</h2>
        <span className="text-xs text-muted-foreground">
          Shell commands Companion runs (Computer access on). Read-only.
        </span>
        <div className="ml-auto flex items-center gap-1">
          {onClear && commands.length ? (
            <button type="button" className="rounded-sm px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-secondary" onClick={onClear}>
              Clear
            </button>
          ) : null}
          {onClose ? (
            <button
              type="button"
              aria-label="Close Companion commands"
              className="rounded-sm p-0.5 text-muted-foreground hover:bg-secondary"
              onClick={onClose}
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>
      </header>
      {commands.length === 0 ? (
        <p data-testid="companion-command-empty" className="px-3 pb-2 text-xs text-muted-foreground">
          No commands yet. Companion only runs shell commands when Computer access is on for its turn; notebook edits and cell runs show in the notebook itself.
        </p>
      ) : (
        <ol ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {commands.map((entry) => {
            const open = expanded.has(entry.key) || entry.status === "running";
            return (
              <li key={entry.key} data-testid="companion-command" data-status={entry.status} className="rounded-sm">
                <button
                  type="button"
                  aria-expanded={open}
                  className="flex w-full items-start gap-1.5 rounded-sm px-1 py-1 text-left hover:bg-secondary"
                  onClick={() => toggle(entry.key)}
                >
                  {open ? <ChevronDown className="mt-0.5 size-3 shrink-0 text-muted-foreground" /> : <ChevronRight className="mt-0.5 size-3 shrink-0 text-muted-foreground" />}
                  <CommandStatusIcon entry={entry} />
                  <code className="min-w-0 flex-1 whitespace-pre-wrap break-all font-mono text-xs text-foreground">{entry.command}</code>
                  {entry.exitCode !== null ? (
                    <span className={cn("shrink-0 text-xs", entry.exitCode === 0 ? "text-muted-foreground" : "text-destructive")}>
                      exit {entry.exitCode}
                    </span>
                  ) : null}
                </button>
                {open ? (
                  <pre
                    data-testid="companion-command-output"
                    className="ml-6 mb-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-sm bg-muted px-2 py-1 font-mono text-xs text-muted-foreground"
                  >
                    {entry.output ? `${entry.outputTruncated ? "… (earlier output trimmed)\n" : ""}${entry.output}` : entry.status === "running" ? "Running…" : "(no output)"}
                  </pre>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function CommandStatusIcon({ entry }: { entry: CompanionCommandEntry }) {
  if (entry.status === "running") return <LoaderCircle aria-label="Running" className="mt-0.5 size-3 shrink-0 animate-spin text-accent" />;
  if (entry.status === "failed") return <X aria-label="Failed" className="mt-0.5 size-3 shrink-0 text-destructive" />;
  return <Check aria-label="Completed" className="mt-0.5 size-3 shrink-0 text-muted-foreground" />;
}
