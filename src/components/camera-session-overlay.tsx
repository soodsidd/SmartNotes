"use client";
import React from "react";
import { Check, X } from "lucide-react";

interface CapturedPhoto {
  dataUrl: string;
  file: File;
}

interface CameraSessionOverlayProps {
  onSubmit: (files: File[]) => void;
  onCancel: () => void;
}

/**
 * SN-340: Full-screen in-app camera session using getUserMedia.
 * User can take many photos (each held as a pending thumbnail), then
 * Submit to batch-insert all into the note, or Cancel to discard.
 */
export function CameraSessionOverlay({ onSubmit, onCancel }: CameraSessionOverlayProps) {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const [pendingPhotos, setPendingPhotos] = React.useState<CapturedPhoto[]>([]);
  const [cameraError, setCameraError] = React.useState<string | null>(null);
  const [isStreaming, setIsStreaming] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          if (!cancelled) setIsStreaming(true);
        }
      } catch (err) {
        if (!cancelled) {
          const msg =
            err instanceof DOMException && err.name === "NotAllowedError"
              ? "Camera permission denied. Allow camera access and try again."
              : "Camera unavailable on this device.";
          setCameraError(msg);
        }
      }
    }
    void startCamera();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  function capturePhoto() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !isStreaming) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const file = new File([blob], `photo-${Date.now()}.jpg`, { type: "image/jpeg" });
        const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
        setPendingPhotos((prev) => [...prev, { dataUrl, file }]);
      },
      "image/jpeg",
      0.9
    );
  }

  function removePhoto(index: number) {
    setPendingPhotos((prev) => prev.filter((_, i) => i !== index));
  }

  function handleSubmit() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    onSubmit(pendingPhotos.map((p) => p.file));
  }

  function handleCancel() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    onCancel();
  }

  const canSubmit = pendingPhotos.length > 0;

  return (
    <div
      data-testid="camera-session-overlay"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        backgroundColor: "#000",
        display: "flex",
        flexDirection: "column",
        userSelect: "none",
      }}
    >
      {/* Live preview */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          data-testid="camera-session-video"
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
        <canvas ref={canvasRef} style={{ display: "none" }} />

        {cameraError ? (
          <div
            data-testid="camera-session-error"
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "2rem",
              textAlign: "center",
              color: "#fff",
              fontSize: "0.9375rem",
              fontFamily: "inherit",
            }}
          >
            {cameraError}
          </div>
        ) : null}

        {/* Cancel X — top-right */}
        <button
          type="button"
          data-testid="camera-session-cancel"
          onClick={handleCancel}
          style={{
            position: "absolute",
            top: "1rem",
            right: "1rem",
            width: "44px",
            height: "44px",
            borderRadius: "50%",
            backgroundColor: "rgba(0,0,0,0.55)",
            border: "1px solid rgba(255,255,255,0.25)",
            color: "#fff",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 0,
          }}
        >
          <X style={{ width: "1.125rem", height: "1.125rem" }} />
        </button>
      </div>

      {/* Thumbnail strip */}
      {pendingPhotos.length > 0 ? (
        <div
          data-testid="camera-session-thumbnails"
          style={{
            display: "flex",
            gap: "0.5rem",
            padding: "0.5rem 0.75rem",
            overflowX: "auto",
            backgroundColor: "rgba(0,0,0,0.8)",
            minHeight: "80px",
            alignItems: "center",
          }}
        >
          {pendingPhotos.map((photo, i) => (
            <div key={photo.file.name + i} style={{ position: "relative", flexShrink: 0 }}>
              <img
                src={photo.dataUrl}
                alt={`Photo ${i + 1}`}
                data-testid={`camera-session-thumbnail-${i}`}
                style={{
                  width: "60px",
                  height: "60px",
                  objectFit: "cover",
                  borderRadius: "4px",
                  display: "block",
                }}
              />
              <button
                type="button"
                onClick={() => removePhoto(i)}
                style={{
                  position: "absolute",
                  top: "-6px",
                  right: "-6px",
                  width: "20px",
                  height: "20px",
                  borderRadius: "50%",
                  backgroundColor: "rgba(0,0,0,0.75)",
                  border: "1px solid rgba(255,255,255,0.35)",
                  color: "#fff",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: 0,
                  fontSize: "0.75rem",
                  lineHeight: 1,
                }}
                aria-label={`Remove photo ${i + 1}`}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {/* Bottom controls */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "1rem 1.5rem",
          backgroundColor: "rgba(0,0,0,0.85)",
        }}
      >
        {/* Spacer left (mirrors submit on right for visual centering of shutter) */}
        <div style={{ width: "80px" }} />

        {/* Shutter */}
        <button
          type="button"
          data-testid="camera-session-shutter"
          onClick={capturePhoto}
          disabled={!isStreaming}
          aria-label="Take photo"
          style={{
            width: "72px",
            height: "72px",
            borderRadius: "50%",
            backgroundColor: "#fff",
            border: "4px solid rgba(255,255,255,0.5)",
            boxShadow: "0 0 0 3px rgba(255,255,255,0.2)",
            cursor: isStreaming ? "pointer" : "not-allowed",
            opacity: isStreaming ? 1 : 0.45,
            padding: 0,
            flexShrink: 0,
          }}
        />

        {/* Submit */}
        <button
          type="button"
          data-testid="camera-session-submit"
          onClick={handleSubmit}
          disabled={!canSubmit}
          style={{
            width: "80px",
            height: "44px",
            borderRadius: "22px",
            backgroundColor: canSubmit ? "var(--accent)" : "rgba(255,255,255,0.12)",
            border: "none",
            color: canSubmit ? "var(--accent-foreground)" : "rgba(255,255,255,0.35)",
            cursor: canSubmit ? "pointer" : "not-allowed",
            fontSize: "0.8125rem",
            fontFamily: "inherit",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "0.25rem",
            flexShrink: 0,
          }}
        >
          <Check style={{ width: "0.875rem", height: "0.875rem" }} />
          {canSubmit ? `Add ${pendingPhotos.length}` : "Add"}
        </button>
      </div>
    </div>
  );
}
