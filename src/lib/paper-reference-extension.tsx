"use client";

import * as React from "react";
import { createRoot } from "react-dom/client";
import { Node, mergeAttributes } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { BookOpen, ChevronDown, ChevronRight, X } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PAPER_ID_PATTERN, paperPath } from "./papers";
import { flushPaperFrame } from "./inline-paper-save";

function PaperReferenceView({ id, editable, onRemove }: { id: string; editable: boolean; onRemove: () => void }) {
  const valid = PAPER_ID_PATTERN.test(id);
  const [title, setTitle] = React.useState("Paper");
  const [status, setStatus] = React.useState<"loading" | "ready" | "error">("loading");
  const [open, setOpen] = React.useState(false);
  const [closing, setClosing] = React.useState(false);
  const [error, setError] = React.useState("");
  const [attempt, setAttempt] = React.useState(0);
  const frame = React.useRef<HTMLIFrameElement>(null);
  const trigger = React.useRef<HTMLButtonElement>(null);
  const href = valid ? `/?page=${encodeURIComponent(paperPath(id))}` : "";

  React.useEffect(() => {
    let cancelled = false;
    const read = async () => {
      try {
        if (!valid) throw new Error("Invalid identity");
        const response = await fetch(`/api/page?path=${encodeURIComponent(paperPath(id))}`, { cache: "no-store" });
        if (!response.ok) throw new Error("Paper unavailable");
        const { page } = await response.json();
        if (!cancelled) { setTitle(page.title); setStatus("ready"); }
      } catch { if (!cancelled) setStatus("error"); }
    };
    void read();
    const update = () => { void read(); };
    window.addEventListener("paper-updated", update);
    return () => { cancelled = true; window.removeEventListener("paper-updated", update); };
  }, [id, valid, attempt]);

  const close = async (remove = false) => {
    setClosing(true); setError("");
    if (frame.current && !(await flushPaperFrame(frame.current))) {
      setClosing(false); setError("Paper changes could not be saved. Keep this editor open and retry."); return;
    }
    // Clear the DOM deletion guard before the explicit, save-acknowledged delete.
    frame.current?.removeAttribute("data-paper-editor");
    setOpen(false); setClosing(false);
    if (remove) onRemove(); else trigger.current?.focus();
  };

  return <>
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-secondary p-2">
      <button type="button" ref={trigger} className={cn(buttonVariants({ variant: "ghost" }), "h-auto min-h-11 min-w-0 flex-1 justify-start gap-2 whitespace-normal text-left")} aria-expanded={open} disabled={status !== "ready" || closing || !editable} onClick={() => {
        if (open) void close(); else setOpen(true);
      }}>
        {open ? <ChevronDown className="size-4 shrink-0" /> : <ChevronRight className="size-4 shrink-0" />}<BookOpen className="size-4 shrink-0 text-accent" />
        <span className="min-w-0 break-words">{status === "loading" ? "Loading paper…" : status === "error" ? "Paper unavailable" : title}<span className="block text-xs text-muted-foreground">Bibliography · shared canonical notes</span></span>
      </button>
      {status === "error" && <Button variant="outline" onClick={() => { setStatus("loading"); setAttempt(attempt + 1); }}>Retry</Button>}
      {editable && <Button variant="ghost" size="icon" className="size-11" aria-label={`Remove reference to ${title}`} disabled={closing} onClick={() => void close(true)}><X className="size-4" /></Button>}
    </div>
    {open && <div className="rounded-b-md border border-t-0 border-border bg-surface p-2" data-testid="inline-paper-notes">
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2">
        <p className="min-w-0 break-words text-xs text-muted-foreground">Referring page / Bibliography / {title} · Edits are shared everywhere</p>
        <Button variant="outline" className="min-h-11" disabled={closing} onClick={() => void close()}>{closing ? "Saving…" : "Back to referring page"}</Button>
      </div>
      <iframe ref={frame} src={`${href}&paperInline=1`} title={`Shared paper notes: ${title}`} className="paper-reference-frame" data-paper-editor={id} />
    </div>}
    {error && <p role="alert" className="p-2 text-sm text-destructive">{error}</p>}
  </>;
}

export const PaperReference = Node.create({
  name: "paperReference", group: "block", atom: true, isolating: true,
  addAttributes() {
    return { paperId: { default: null, parseHTML: (element: HTMLElement) => element.getAttribute("data-paper-id"), renderHTML: (attrs: Record<string, unknown>) => ({ "data-paper-id": attrs.paperId }) } };
  },
  parseHTML() { return [{ tag: 'div[data-type="paper-reference"]', getAttrs: (element) => PAPER_ID_PATTERN.test((element as HTMLElement).getAttribute("data-paper-id") ?? "") ? {} : false }]; },
  renderHTML({ HTMLAttributes }) { return ["div", mergeAttributes(HTMLAttributes, { "data-type": "paper-reference" })]; },
  // Each chip owns a React root instead of a Tiptap portal: portals are tied to
  // the EditorContent instance, so a shell re-render could orphan a live chip
  // (stale "Loading" DOM, lost inline editor state).
  addNodeView() {
    return ({ node, editor, getPos }) => {
      const dom = document.createElement("div");
      dom.className = "paper-reference not-prose";
      dom.contentEditable = "false";
      dom.dataset.paperReference = String(node.attrs.paperId ?? "");
      const root = createRoot(dom);
      let current = node;
      let editable = editor.isEditable;
      const remove = () => {
        const pos = typeof getPos === "function" ? getPos() : undefined;
        if (typeof pos === "number") editor.chain().focus().deleteRange({ from: pos, to: pos + current.nodeSize }).run();
      };
      const render = () => root.render(<PaperReferenceView id={String(current.attrs.paperId ?? "")} editable={editable} onRemove={remove} />);
      const syncEditable = () => { if (editable !== editor.isEditable) { editable = editor.isEditable; render(); } };
      editor.on("transaction", syncEditable);
      render();
      return {
        dom,
        update: (next) => {
          if (next.type !== current.type || next.attrs.paperId !== current.attrs.paperId) return false;
          current = next;
          return true;
        },
        stopEvent: () => true,
        ignoreMutation: () => true,
        destroy: () => {
          editor.off("transaction", syncEditable);
          // Unmounting synchronously inside a ProseMirror update can race React rendering.
          window.setTimeout(() => root.unmount(), 0);
        },
      };
    };
  },
  addProseMirrorPlugins() {
    return [new Plugin({ filterTransaction: (transaction, state) => {
      if (!transaction.docChanged || typeof document === "undefined") return true;
      const nextIds = new Map<string, number>();
      const previousIds = new Map<string, number>();
      transaction.doc.descendants((node) => { if (node.type.name === "paperReference") nextIds.set(node.attrs.paperId, (nextIds.get(node.attrs.paperId) ?? 0) + 1); });
      state.doc.descendants((node) => { if (node.type.name === "paperReference") previousIds.set(node.attrs.paperId, (previousIds.get(node.attrs.paperId) ?? 0) + 1); });
      let safe = true;
      state.doc.descendants((node) => {
        if (node.type.name === "paperReference" && (nextIds.get(node.attrs.paperId) ?? 0) < (previousIds.get(node.attrs.paperId) ?? 0) && PAPER_ID_PATTERN.test(node.attrs.paperId) && this.editor.view.dom.querySelector(`iframe[data-paper-editor="${node.attrs.paperId}"]`)) safe = false;
      });
      return safe;
    } })];
  },
});
