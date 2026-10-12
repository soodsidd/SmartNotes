/** Same-origin frames run the standard page save pipeline; closing awaits it. */
export function flushPaperFrame(frame: HTMLIFrameElement): Promise<boolean> {
  const requestId = crypto.randomUUID();
  return new Promise((resolve) => {
    const finish = (saved: boolean) => { window.clearTimeout(timer); window.removeEventListener("message", receive); resolve(saved); };
    const receive = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== frame.contentWindow || event.data?.type !== "paper-flushed" || event.data?.requestId !== requestId) return;
      finish(event.data.saved === true);
    };
    const timer = window.setTimeout(() => finish(false), 15000);
    window.addEventListener("message", receive);
    frame.contentWindow?.postMessage({ type: "paper-flush", requestId }, window.location.origin);
  });
}

export async function flushInlinePapers(): Promise<boolean> {
  const frames = Array.from(document.querySelectorAll<HTMLIFrameElement>("iframe[data-paper-editor]"));
  return (await Promise.all(frames.map(flushPaperFrame))).every(Boolean);
}
