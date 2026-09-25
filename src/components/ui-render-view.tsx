"use client";

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
  | { source: typeof DESIGN_FRAME_MESSAGE_SOURCE; kind: "height"; height: number }
  | { source: typeof DESIGN_FRAME_MESSAGE_SOURCE; kind: "external-link"; href: string };

function designFrameBridgeScript() {
  return `<script data-smart-notes-frame-bridge="true">
(() => {
  const source = ${JSON.stringify(DESIGN_FRAME_MESSAGE_SOURCE)};
  const postHeight = () => {
    const root = document.documentElement;
    const body = document.body;
    const height = Math.max(
      root ? root.scrollHeight : 0,
      root ? root.offsetHeight : 0,
      body ? body.scrollHeight : 0,
      body ? body.offsetHeight : 0
    );
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

export function isDesignFrameMessage(value: unknown): value is DesignFrameMessage {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<DesignFrameMessage>;
  return (
    candidate.source === DESIGN_FRAME_MESSAGE_SOURCE &&
    (candidate.kind === "height" || candidate.kind === "external-link")
  );
}

/**
 * Compose the frame document. A self-contained artifact (with its own <html>)
 * is rendered verbatim; a fragment is wrapped in a minimal responsive shell.
 * Optional token CSS is injected into <head> so the artifact ports to the real app.
 */
export function buildDesignSrcDoc(bodyHtml: string, tokenCss?: string): string {
  const injected = tokenCss ? `<style data-av-tokens="true">${tokenCss}</style>` : "";
  const bridge = designFrameBridgeScript();
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
