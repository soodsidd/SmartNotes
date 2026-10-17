"use client";

import * as React from "react";
import { normalizePdfCrop, nudgePdfCrop, type PdfCropFraction } from "@/lib/pdf-record";

/**
 * SN-336 explicit Record-area crop surface. Mounted over one page frame only
 * while crop mode is on, so ordinary pan, pinch, selection and annotation
 * gestures elsewhere are untouched. Pointer events are claimed in the capture
 * phase and kept from EmbedPDF's page pointer provider (which would otherwise
 * start a text selection), and clicks never toggle reader chrome or tap-turn.
 */
export function PdfCropLayer({ crop, onCropChange, pageNumber }: {
  crop: PdfCropFraction | null;
  onCropChange: (crop: PdfCropFraction | null) => void;
  pageNumber: number;
}) {
  const drag = React.useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => { ref.current?.focus({ preventScroll: true }); }, []);
  const point = (event: React.PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return { x: box.width ? (event.clientX - box.left) / box.width : 0, y: box.height ? (event.clientY - box.top) / box.height : 0 };
  };
  const claim = (event: React.SyntheticEvent) => { event.nativeEvent.stopImmediatePropagation(); event.stopPropagation(); };
  return (
    <div
      ref={ref}
      className="pdf-reader__crop-layer"
      data-testid="pdf-reader-crop-layer"
      tabIndex={0}
      role="group"
      aria-label={`Select an area on page ${pageNumber}. Drag, or use arrow keys to move and Shift+arrow keys to resize.`}
      onPointerDownCapture={(event) => {
        claim(event);
        if (event.pointerType === "mouse" && event.button !== 0) return;
        if (drag.current) return; // a second finger never restarts the area
        event.preventDefault();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        const start = point(event);
        drag.current = { pointerId: event.pointerId, ...start };
        onCropChange(normalizePdfCrop(start, start));
      }}
      onPointerMoveCapture={(event) => {
        if (drag.current?.pointerId !== event.pointerId) return;
        claim(event);
        event.preventDefault();
        onCropChange(normalizePdfCrop(drag.current, point(event)));
      }}
      onPointerUpCapture={(event) => {
        claim(event);
        if (drag.current?.pointerId === event.pointerId) drag.current = null;
      }}
      onPointerCancelCapture={(event) => {
        claim(event);
        if (drag.current?.pointerId === event.pointerId) drag.current = null;
      }}
      onClickCapture={claim}
      onContextMenuCapture={(event) => { claim(event); event.preventDefault(); }}
      onKeyDown={(event) => {
        if (!event.key.startsWith("Arrow") && event.key !== "Enter") return;
        if (event.key === "Enter" && crop) return; // Enter on an existing area is left to the toolbar
        event.preventDefault();
        event.stopPropagation();
        onCropChange(nudgePdfCrop(crop, event.key, event.shiftKey));
      }}
    >
      {crop ? (
        <div
          className="pdf-reader__crop-rect"
          data-testid="pdf-reader-crop-rect"
          style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.width * 100}%`, height: `${crop.height * 100}%` }}
        />
      ) : null}
    </div>
  );
}
