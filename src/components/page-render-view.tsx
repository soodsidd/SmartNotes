"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { RichTextEditor } from "@/components/rich-text-editor";
import type { AnnotationLayerHandle } from "@/components/annotation-layer";
import { computePageFrameHeight } from "@/lib/page-frame";

const AnnotationLayer = dynamic(
  () => import("@/components/annotation-layer").then((module) => module.AnnotationLayer),
  { ssr: false }
);

export interface PageRenderViewProps {
  pagePath: string;
  title: string;
  bodyHtml: string;
  annotationsScene: unknown;
  drawableBottom?: number;
}

export function PageRenderView({
  pagePath,
  title,
  bodyHtml,
  annotationsScene,
  drawableBottom,
}: PageRenderViewProps) {
  const annotationLayerRef = React.useRef<AnnotationLayerHandle | null>(null);
  const [inkReady, setInkReady] = React.useState(false);
  const [editorReady, setEditorReady] = React.useState(false);
  const previewJson = React.useMemo(
    () => JSON.stringify({ scene: annotationsScene ?? null, drawableBottom }),
    [annotationsScene, drawableBottom]
  );

  const captureReady = editorReady && inkReady;

  return (
    <div
      className="page-render-root bg-background text-foreground"
      data-testid="page-render-root"
      data-page-render-ready={captureReady ? "true" : undefined}
      style={{ width: "760px", margin: "0 auto", padding: "24px 20px 40px" }}
    >
      <header className="mb-5">
        <h1 className="text-3xl font-semibold tracking-tight">{title.trim() || "Untitled page"}</h1>
      </header>
      <div className="relative" style={{ minHeight: computePageFrameHeight({ textHeight: 0, viewportHeight: 900, drawableBottom }) }}>
        <RichTextEditor
          content={bodyHtml}
          onChange={() => undefined}
          pagePath={pagePath}
          pageTitle={title}
          readOnly
          hideFormatToolbar
          inkCaptureMode
          drawableBottom={drawableBottom}
          annotationLayerRef={annotationLayerRef}
          onEditorReady={(editor) => setEditorReady(Boolean(editor))}
          annotationOverlay={
            <AnnotationLayer
              handleRef={annotationLayerRef}
              pagePath={pagePath}
              mode="edit"
              readOnly
              previewSidecarJson={previewJson}
              onSceneChange={() => setInkReady(true)}
            />
          }
        />
      </div>
    </div>
  );
}
