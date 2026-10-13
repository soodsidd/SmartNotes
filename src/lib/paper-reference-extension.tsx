"use client";

import * as React from "react";
import { createRoot } from "react-dom/client";
import { Node, mergeAttributes } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import { Plugin, Selection } from "@tiptap/pm/state";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PAPER_ID_PATTERN, paperPath } from "./papers";
import { registerInlinePaperEditor } from "./inline-paper-save";
import { createEditorExtensions } from "./rich-text-editor-config";
import { loadInlinePaper, saveInlinePaper, type InlinePaperSnapshot } from "./inline-paper";

// The inline editor is nested inside the referring page's editor. Native caret
// movement (Ctrl+End, arrows past the paper's edges) can carry focus into the
// referring page, where further typing would edit that page instead of the
// paper. Only a pointer gesture may move focus out of an inline paper editor.
let lastPointerDownAt = 0;
if (typeof document !== "undefined") {
  document.addEventListener("pointerdown", () => { lastPointerDownAt = Date.now(); }, true);
}

/** True when an enclosing (referring) editor takes focus from an editing inline paper without a pointer gesture. */
export function isInlinePaperFocusEscape(inner: Element, target: EventTarget | null, related: EventTarget | null, now = Date.now(), pointerDownAt = lastPointerDownAt): boolean {
  if (now - pointerDownAt < 600 || !(target instanceof Element) || !target.classList.contains("ProseMirror")) return false;
  if (target === inner || inner.contains(target) || !target.contains(inner)) return false;
  return related === null || (related instanceof globalThis.Node && inner.contains(related));
}

const CARET_KEYS: Record<string, -1 | 1> = { ArrowUp: -1, ArrowLeft: -1, PageUp: -1, ArrowDown: 1, ArrowRight: 1, PageDown: 1 };

function PaperReferenceView({ id, editable, onRemove }: { id: string; editable: boolean; onRemove: () => void }) {
  const valid = PAPER_ID_PATTERN.test(id);
  const [snapshot, setSnapshot] = React.useState<InlinePaperSnapshot | null>(null);
  const snapshotRef = React.useRef<InlinePaperSnapshot | null>(null);
  const [status, setStatus] = React.useState<"loading" | "ready" | "error">("loading");
  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [dirty, setDirty] = React.useState(false);
  const [edits, setEdits] = React.useState(0);
  const dirtyRef = React.useRef(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const saveInFlight = React.useRef<Promise<boolean> | null>(null);
  const trigger = React.useRef<HTMLButtonElement>(null);
  const extensions = React.useMemo(() => createEditorExtensions(), []);
  const editor = useEditor({
    extensions,
    content: "<p></p>",
    editable: false,
    immediatelyRender: false,
    editorProps: {
      handleKeyDown: (view, event) => {
        const direction = CARET_KEYS[event.key];
        if (direction && !event.shiftKey) {
          // Keep the caret inside the paper at its first/last block edges.
          const { selection, doc } = view.state;
          const edge = direction < 0 ? selection.$from.index(0) === 0 : selection.$to.index(0) === doc.childCount - 1;
          const dir = event.key === "ArrowUp" || event.key === "PageUp" ? "up" : event.key === "ArrowDown" || event.key === "PageDown" ? "down" : direction < 0 ? "left" : "right";
          if (edge && (event.key.startsWith("Page") || view.endOfTextblock(dir))) { event.preventDefault(); return true; }
          return false;
        }
        if (!(event.ctrlKey || event.metaKey) || (event.key !== "Home" && event.key !== "End")) return false;
        const selection = event.key === "Home" ? Selection.atStart(view.state.doc) : Selection.atEnd(view.state.doc);
        view.dispatch(view.state.tr.setSelection(selection).scrollIntoView());
        return true;
      },
    },
    onUpdate: () => { dirtyRef.current = true; setDirty(true); setEdits((count) => count + 1); },
  });

  const refresh = React.useCallback(async () => {
    if (!valid) { setStatus("error"); return; }
    setStatus("loading"); setError("");
    try {
      const next = await loadInlinePaper(id);
      editor?.commands.setContent(next.body, { emitUpdate: false });
      snapshotRef.current = next; setSnapshot(next); dirtyRef.current = false; setDirty(false); setStatus("ready");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Paper unavailable.");
      setStatus("error");
    }
  }, [editor, id, valid]);

  React.useEffect(() => {
    if (!editor) return;
    void refresh();
  }, [editor, refresh]);

  // emitUpdate=false: entering Edit must not mark the paper dirty or write it.
  React.useEffect(() => { editor?.setEditable(editing, false); }, [editor, editing]);

  React.useEffect(() => {
    if (!editor || !editing) return;
    const dom = editor.view.dom;
    const onFocusIn = (event: FocusEvent) => {
      if (isInlinePaperFocusEscape(dom, event.target, event.relatedTarget)) editor.commands.focus();
    };
    document.addEventListener("focusin", onFocusIn, true);
    return () => document.removeEventListener("focusin", onFocusIn, true);
  }, [editor, editing]);

  const save = React.useCallback(async (): Promise<boolean> => {
    if (saveInFlight.current) return saveInFlight.current;
    if (!editing || !dirtyRef.current) return true;
    if (!snapshotRef.current || !editor) return false;
    const attempt = (async () => {
      setBusy(true); setError("");
      try {
        let verified = snapshotRef.current!;
        while (editor.getHTML() !== verified.body) {
          const body = editor.getHTML();
          verified = await saveInlinePaper(verified, body);
        }
        snapshotRef.current = verified; setSnapshot(verified);
        dirtyRef.current = false;
        setDirty(false);
        window.dispatchEvent(new Event("paper-updated"));
        return true;
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Paper changes could not be saved.");
        return false;
      } finally { setBusy(false); }
    })();
    saveInFlight.current = attempt;
    try { return await attempt; } finally { saveInFlight.current = null; }
  }, [editing, editor]);

  React.useEffect(() => registerInlinePaperEditor(save), [save]);

  // Live editing: debounce through the same conditional, verified save. Any
  // error (conflict, unverified write) halts autosave until the user acts.
  React.useEffect(() => {
    if (!editing || !dirty || busy || error) return;
    const timer = window.setTimeout(() => { void save(); }, 1200);
    return () => window.clearTimeout(timer);
  }, [busy, dirty, editing, edits, error, save]);

  const close = async (remove = false) => {
    if (!(await save())) return;
    if (remove) trigger.current?.closest(".paper-reference")?.querySelector("[data-paper-editor]")?.removeAttribute("data-paper-editor");
    setEditing(false); setOpen(false);
    if (remove) onRemove(); else trigger.current?.focus();
  };

  const openFullPaper = async () => {
    if (!(await save())) return;
    window.dispatchEvent(new CustomEvent("paper-open-request", { detail: paperPath(id) }));
  };

  return <>
    <div className="group inline-flex max-w-full items-center rounded-full border border-accent/50 bg-secondary/30 text-sm text-foreground">
      <button type="button" ref={trigger} className="flex size-8 shrink-0 items-center justify-center rounded-l-full hover:bg-secondary focus-visible:outline-ring" aria-label={`${open ? "Collapse" : "Expand"} paper ${snapshot?.title ?? "reference"}`} aria-expanded={open} disabled={busy} onClick={() => { if (open) void close(); else { setOpen(true); void refresh(); } }}>
        {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
      </button>
      <span className="rounded-sm bg-paper px-1 text-xs font-bold text-primary-foreground">PAPER</span>
      <button type="button" className="min-w-0 truncate px-2 py-1 text-left hover:underline focus-visible:outline-ring" disabled={status !== "ready" || busy} onClick={() => void openFullPaper()}>{snapshot?.title ?? (status === "error" ? "Paper unavailable" : "Loading paper…")}</button>
      {editable && <button type="button" className="mr-1 flex size-6 items-center justify-center rounded-full text-muted-foreground opacity-0 hover:bg-secondary focus:opacity-100 group-hover:opacity-100" aria-label={`Remove reference to ${snapshot?.title ?? "paper"}`} disabled={busy} onClick={() => void close(true)}><X className="size-3" /></button>}
    </div>
    {open && <div className="mt-2 border-l-4 border-accent bg-surface py-3 pl-4 pr-3" data-testid="inline-paper-notes" data-paper-editor={id}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><h3 className="font-bold">{snapshot?.title ?? "Paper"}</h3><p className="text-xs text-muted-foreground">Shared paper notes · {editing ? "editing" : "read-only"}</p></div>
        <div className="flex items-center gap-2">
          {editing ? <><Button size="sm" disabled={busy || !dirty} onClick={() => void save()}>{busy ? "Saving…" : "Save"}</Button><Button variant="ghost" size="sm" disabled={busy} onClick={() => { editor?.commands.setContent(snapshot?.body ?? "", { emitUpdate: false }); dirtyRef.current = false; setDirty(false); setEditing(false); setError(""); }}>Cancel</Button></> : <Button size="sm" disabled={status !== "ready" || busy} onClick={() => setEditing(true)}>Edit</Button>}
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => void close()}>Collapse</Button>
        </div>
      </div>
      {status === "ready" && <EditorContent editor={editor} className="editor-content my-6 min-h-20" />}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>PDF and ink remain in the full paper view.</span>
        <button type="button" className="hover:underline" disabled={busy} onClick={() => { if (dirty) { setError("Save or Cancel your edits before refreshing."); return; } void refresh(); }}>Refresh</button>
        <button type="button" className="hover:underline" disabled={busy} onClick={() => void openFullPaper()}>Open full paper</button>
      </div>
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
        if (node.type.name === "paperReference" && (nextIds.get(node.attrs.paperId) ?? 0) < (previousIds.get(node.attrs.paperId) ?? 0) && PAPER_ID_PATTERN.test(node.attrs.paperId) && this.editor.view.dom.querySelector(`[data-paper-editor="${node.attrs.paperId}"]`)) safe = false;
      });
      return safe;
    } })];
  },
});
