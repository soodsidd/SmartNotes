"use client";
import { inlineAiFrameScript, parseInlineAiContext, type InlineAiContext } from "@/lib/inline-ai";
import { DESIGN_CONTENT_HEIGHT_EXPRESSION } from "@/lib/design-pagination";
import { DESIGN_COMMENT_QUOTE_LIMIT } from "@/lib/comment-types";

import * as React from "react";
import dynamic from "next/dynamic";
import type { AnnotationLayerHandle } from "@/components/annotation-layer";

const AnnotationLayer = dynamic(
  () => import("@/components/annotation-layer").then((module) => module.AnnotationLayer),
  { ssr: false }
);

export interface UiRenderViewProps {
  pagePath: string;
  title: string;
  /** Raw HTML/CSS artifact body — rendered verbatim, NOT through Tiptap. */
  bodyHtml: string;
  /** Viewport width in CSS px so responsive media queries fire faithfully. */
  viewportWidth: number;
  annotationsScene: unknown;
  drawableBottom?: number;
  /** Optional target-project token stylesheet injected into the frame <head>. */
  tokenCss?: string;
}

const DESIGN_FRAME_MESSAGE_SOURCE = "smart-notes-design-frame";

export type DesignFrameMessage =
  | { source: typeof DESIGN_FRAME_MESSAGE_SOURCE; kind: "ask-companion"; x: number; y: number; context: InlineAiContext }
  | { source: typeof DESIGN_FRAME_MESSAGE_SOURCE; kind: "height"; height: number }
  | { source: typeof DESIGN_FRAME_MESSAGE_SOURCE; kind: "edit"; path: number[]; html: string; mode: "inner" | "outer" }
  | { source: typeof DESIGN_FRAME_MESSAGE_SOURCE; kind: "external-link"; href: string }
  // SN-310: element under a right-click / touch press, posted before ask-companion.
  | { source: typeof DESIGN_FRAME_MESSAGE_SOURCE; kind: "comment-anchor"; path: number[]; tag: string; quote: string }
  // SN-310: frame-document rects for commented elements (reply to comment-rects-request).
  | { source: typeof DESIGN_FRAME_MESSAGE_SOURCE; kind: "comment-rects"; rects: DesignCommentRect[] };

export interface DesignCommentRect {
  id: string;
  top: number;
  left: number;
  width: number;
  height: number;
}

function designFrameBridgeScript(editable = false) {
  return `<script data-smart-notes-frame-bridge="true">
(() => {
  ${inlineAiFrameScript(DESIGN_FRAME_MESSAGE_SOURCE)}
  const source = ${JSON.stringify(DESIGN_FRAME_MESSAGE_SOURCE)};
  const editable = ${editable};
  const postHeight = () => {
    const height = ${DESIGN_CONTENT_HEIGHT_EXPRESSION};
    parent.postMessage({ source, kind: "height", height }, "*");
  };

  document.addEventListener("click", (event) => {
    const target = event.target;
    const anchor = target && target.closest ? target.closest("a") : null;
    if (!anchor) return;
    const href = anchor.getAttribute("href");
    if (!href || href.startsWith("#")) return;
    event.preventDefault();
    event.stopPropagation();
    if (/^https?:\\/\\//i.test(href)) {
      parent.postMessage({ source, kind: "external-link", href }, "*");
    }
  }, true);

  const elementChildren = (node) => Array.from(node.children || []);
  const pathFor = (node) => {
    const path = [];
    while (node && node !== document.body) {
      const parentNode = node.parentElement;
      if (!parentNode) return null;
      path.unshift(elementChildren(parentNode).indexOf(node));
      node = parentNode;
    }
    return node === document.body ? path : null;
  };
  const nodeAtPath = (path) => {
    let node = document.body;
    for (const index of path) {
      node = node ? elementChildren(node)[index] : null;
    }
    return node || null;
  };

  // SN-310 companion comments: report the pressed element (capture phase, so it
  // reaches the host before the inline-AI ask-companion menu message).
  const postCommentAnchor = (event) => {
    const target = event.target;
    if (!(target instanceof Element) || !document.body) return;
    const element = target.closest('p,li,h1,h2,h3,h4,h5,h6,blockquote,pre,td,th,figcaption,img,a,button') || target;
    const path = pathFor(element);
    if (!path) return;
    const selected = String(window.getSelection() || '').replace(/\\s+/g, ' ').trim();
    const copy = element.cloneNode(true);
    if (copy.querySelectorAll) copy.querySelectorAll('script,style,noscript').forEach((n) => n.remove());
    const own = (copy.textContent || element.getAttribute('alt') || '').replace(/\\s+/g, ' ').trim();
    const quote = (selected || own).slice(0, ${DESIGN_COMMENT_QUOTE_LIMIT});
    parent.postMessage({ source, kind: 'comment-anchor', path, tag: element.tagName.toLowerCase(), quote }, '*');
  };
  document.addEventListener('contextmenu', postCommentAnchor, true);
  document.addEventListener('pointerdown', (event) => { if (event.pointerType === 'touch') postCommentAnchor(event); }, true);
  window.addEventListener('message', (event) => {
    if (event.source !== parent || event.data?.source !== source) return;
    // SN-319: host asks for a fresh height after A4 guide toggle / width change.
    if (event.data?.kind === 'height-request') {
      postHeight();
      return;
    }
    if (event.data?.kind !== 'comment-rects-request') return;
    const items = Array.isArray(event.data.items) ? event.data.items : [];
    const rects = [];
    for (const item of items) {
      if (!item || typeof item.id !== 'string' || !Array.isArray(item.path)) continue;
      const node = nodeAtPath(item.path);
      if (!node || node === document.body) continue;
      const rect = node.getBoundingClientRect();
      rects.push({ id: item.id, top: rect.top + window.scrollY, left: rect.left + window.scrollX, width: rect.width, height: rect.height });
    }
    parent.postMessage({ source, kind: 'comment-rects', rects }, '*');
  });

  if (editable) {
    let active = null;
    let activePath = null;
    let savedRange = null;
    let suppressInput = false;
    const originalAttrs = new WeakMap();
    const editTarget = (node) => {
      if (!(node instanceof Element) || !document.body.contains(node)) return null;
      if (node.closest('script,style,textarea,input,button,select,[contenteditable="false"]')) return null;
      const block = node.closest('p,h1,h2,h3,h4,h5,h6,li,blockquote,td,th,figcaption');
      if (block) return block;
      let current = node;
      while (current && current !== document.body) {
        if (!current.querySelector('p,h1,h2,h3,h4,h5,h6,li,blockquote,td,th') && current.textContent?.trim()) return current;
        current = current.parentElement;
      }
      return null;
    };
    const restoreAttrs = (node, owner = node) => {
      for (const [name, value] of Object.entries(originalAttrs.get(owner) || {})) {
        if (value === null) node.removeAttribute(name); else node.setAttribute(name, value);
      }
    };
    const sendEdit = (node = active, path = activePath, mode = 'inner') => {
      if (!node || !path) return;
      let html = node.innerHTML;
      if (mode === 'outer') {
        // Serialize without the editor's own contenteditable/spellcheck attributes.
        const clone = node.cloneNode(true);
        restoreAttrs(clone, node);
        html = clone.outerHTML;
      }
      parent.postMessage({ source, kind: 'edit', path, html, mode }, '*');
      postHeight();
    };
    document.addEventListener('pointerdown', (event) => {
      const next = editTarget(event.target);
      if (!next || next === active) return;
      if (active) restoreAttrs(active);
      active = next;
      activePath = pathFor(next);
      originalAttrs.set(next, { contenteditable: next.getAttribute('contenteditable'), spellcheck: next.getAttribute('spellcheck') });
      active.setAttribute('contenteditable', 'true');
      active.setAttribute('spellcheck', 'true');
    }, true);
    document.addEventListener('selectionchange', () => {
      const selection = document.getSelection();
      if (active && selection?.rangeCount && active.contains(selection.anchorNode)) savedRange = selection.getRangeAt(0).cloneRange();
    });
    document.addEventListener('input', (event) => {
      if (!suppressInput && active && active.contains(event.target)) sendEdit();
    });
    window.addEventListener('message', (event) => {
      if (event.source !== parent || event.data?.source !== source || event.data?.kind !== 'format' || !active) return;
      const command = event.data.command;
      if (!['bold','italic','underline','insertUnorderedList','insertOrderedList','undo','redo','createLink'].includes(command)) return;
      active.focus();
      const selection = document.getSelection();
      if (savedRange && selection) { selection.removeAllRanges(); selection.addRange(savedRange); }
      const beforePath = activePath;
      const before = active;
      const beforeParent = before.parentElement;
      suppressInput = true;
      document.execCommand(command, false, command === 'createLink' ? event.data.value : undefined);
      suppressInput = false;
      if (command === 'insertUnorderedList' || command === 'insertOrderedList') {
        const next = beforeParent && beforePath ? elementChildren(beforeParent)[beforePath[beforePath.length - 1]] : null;
        if (next) {
          sendEdit(next, beforePath, 'outer');
          restoreAttrs(before);
          active = null;
          activePath = null;
        }
      } else {
        sendEdit();
      }
    });
  }

  const start = () => {
    postHeight();
    if (typeof ResizeObserver !== "undefined" && document.documentElement) {
      new ResizeObserver(postHeight).observe(document.documentElement);
    }
    [120, 400, 900, 2000].forEach((delay) => setTimeout(postHeight, delay));
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
  window.addEventListener("load", postHeight);
})();
</script>`;
}

function isElementPath(value: unknown): value is number[] {
  return Array.isArray(value) && value.length <= 64 && value.every((index) => Number.isInteger(index) && index >= 0);
}

function isCommentAnchorMessage(candidate: Record<string, unknown>) {
  return (
    candidate.kind === "comment-anchor" &&
    isElementPath(candidate.path) &&
    typeof candidate.tag === "string" &&
    /^[a-z][a-z0-9-]{0,31}$/.test(candidate.tag) &&
    typeof candidate.quote === "string" &&
    candidate.quote.length <= DESIGN_COMMENT_QUOTE_LIMIT
  );
}

function isCommentRectsMessage(candidate: Record<string, unknown>) {
  return (
    candidate.kind === "comment-rects" &&
    Array.isArray(candidate.rects) &&
    candidate.rects.every(
      (rect) =>
        rect &&
        typeof rect === "object" &&
        typeof (rect as DesignCommentRect).id === "string" &&
        ["top", "left", "width", "height"].every((key) => Number.isFinite((rect as unknown as Record<string, unknown>)[key]))
    )
  );
}

export function isDesignFrameMessage(value: unknown): value is DesignFrameMessage {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<DesignFrameMessage>;
  return (
    candidate.source === DESIGN_FRAME_MESSAGE_SOURCE &&
    (candidate.kind === "height" || candidate.kind === "external-link" || isCommentAnchorMessage(candidate) || isCommentRectsMessage(candidate) || (candidate.kind === "edit" && Array.isArray(candidate.path) && typeof candidate.html === "string" && (candidate.mode === "inner" || candidate.mode === "outer")) || (candidate.kind === "ask-companion" && Number.isFinite(candidate.x) && Number.isFinite(candidate.y) && parseInlineAiContext(candidate.context)?.surface === "design"))
  );
}

/**
 * Compose the frame document. A self-contained artifact (with its own <html>)
 * is rendered verbatim; a fragment is wrapped in a minimal responsive shell.
 * Optional token CSS is injected into <head> so the artifact ports to the real app.
 */
export function buildDesignSrcDoc(bodyHtml: string, tokenCss?: string, editable = false): string {
  const injected = tokenCss ? `<style data-av-tokens="true">${tokenCss}</style>` : "";
  const bridge = designFrameBridgeScript(editable);
  const hasHtmlShell = /<html[\s>]/i.test(bodyHtml);
  if (hasHtmlShell) {
    if (/<\/head>/i.test(bodyHtml)) {
      return bodyHtml.replace(/<\/head>/i, `${injected}${bridge}</head>`);
    }
    return `${injected}${bridge}${bodyHtml}`;
  }
  return [
    "<!doctype html><html><head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    "<style>html,body{margin:0;padding:0;}</style>",
    injected,
    bridge,
    "</head><body>",
    bodyHtml,
    "</body></html>",
  ].join("");
}

/**
 * Raw-HTML design render surface (note_type=design, SN-167). The artifact body
 * is rendered in an isolated `srcDoc` iframe so real CSS applies faithfully,
 * with a read-only ink overlay composited on top for capture parity with the
 * live design view.
 */
export function UiRenderView({
  pagePath,
  title,
  bodyHtml,
  viewportWidth,
  annotationsScene,
  drawableBottom,
  tokenCss,
}: UiRenderViewProps) {
  const annotationLayerRef = React.useRef<AnnotationLayerHandle | null>(null);
  const iframeRef = React.useRef<HTMLIFrameElement | null>(null);
  const [frameReady, setFrameReady] = React.useState(false);
  const [inkReady, setInkReady] = React.useState(false);
  const [frameHeight, setFrameHeight] = React.useState(900);

  const srcDoc = React.useMemo(() => buildDesignSrcDoc(bodyHtml, tokenCss), [bodyHtml, tokenCss]);
  const previewJson = React.useMemo(
    () => JSON.stringify({ scene: annotationsScene ?? null, drawableBottom }),
    [annotationsScene, drawableBottom]
  );

  React.useEffect(() => {
    const handleMessage = (event: MessageEvent<unknown>) => {
      if (event.source !== iframeRef.current?.contentWindow || !isDesignFrameMessage(event.data)) {
        return;
      }
      if (
        event.data.kind === "height" &&
        Number.isFinite(event.data.height) &&
        event.data.height > 0
      ) {
        const next = Math.max(event.data.height, drawableBottom ?? 0, 900);
        setFrameHeight((current) => (next > current ? next : current));
        setFrameReady(true);
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [drawableBottom]);

  const handleLoad = React.useCallback(() => {
    setFrameReady(true);
  }, []);

  // Capture must never hang on a missing signal. If the iframe onLoad or the
  // ink overlay's onSceneChange does not fire (headless quirks, empty scene),
  // force-measure and mark ready after a bounded grace period so renderUiToPng
  // still produces a faithful capture instead of timing out.
  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      setFrameReady(true);
      setInkReady(true);
    }, 2500);
    return () => window.clearTimeout(timer);
  }, []);

  const captureReady = frameReady && inkReady;

  return (
    <div
      className="ui-render-root bg-background text-foreground"
      data-testid="ui-render-root"
      data-ui-render-ready={captureReady ? "true" : undefined}
      style={{ width: `${viewportWidth}px`, margin: "0 auto", position: "relative" }}
    >
      <iframe
        ref={iframeRef}
        title={title.trim() || "Design page"}
        data-testid="ui-render-frame"
        srcDoc={srcDoc}
        onLoad={handleLoad}
        // Scripts are required by bundled standalone artifacts. Omitting
        // allow-same-origin gives the frame an opaque origin, so its scripts
        // cannot read or mutate Smart Notes. Height is reported via postMessage.
        sandbox="allow-scripts"
        scrolling="no"
        style={{
          display: "block",
          width: "100%",
          height: `${frameHeight}px`,
          border: "0",
          background: "#ffffff",
        }}
      />
      <div
        className="absolute inset-0"
        style={{ pointerEvents: "none", height: `${frameHeight}px` }}
        data-testid="ui-render-ink-overlay"
      >
        <AnnotationLayer
          handleRef={annotationLayerRef}
          pagePath={pagePath}
          mode="edit"
          readOnly
          previewSidecarJson={previewJson}
          viewportHeight={frameHeight}
          pageFrameHeight={frameHeight}
          onSceneChange={() => setInkReady(true)}
        />
      </div>
    </div>
  );
}
