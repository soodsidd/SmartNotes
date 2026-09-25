/**
 * SN-161: companion/sidebar resize — smooth drag + over-PDF width control.
 *
 * The resize handlers live deep in the ~5k-line notebook shell, so behaviour is
 * pinned with source assertions (the same approach sn-43-ux-polish uses for this
 * component) plus the clamp/persistence contract from the shared lib helpers.
 */
import fs from "node:fs";
import path from "node:path";
import {
  AI_SIDEBAR_MAX_VIEWPORT_RATIO,
  AI_SIDEBAR_MIN_WIDTH,
  clampAiSidebarWidth,
  getAiSidebarMaxWidth,
} from "@/lib/ai-sidebar";

const shellSrc = fs.readFileSync(
  path.join(process.cwd(), "src/components/notebook-shell-reliable.tsx"),
  "utf8"
);

describe("SN-161 over-PDF companion resize", () => {
  it("renders the AI resize handle even when the companion is over the reader", () => {
    // The handle must not be gated behind !companionOverReader anymore.
    expect(shellSrc).toContain('data-testid="ai-sidebar-resize-handle"');
    expect(shellSrc).not.toContain("!companionOverReader ? (");
  });

  it("applies the persisted clamped width in both presentations", () => {
    // The fixed 24rem/42vw lock is gone; the rail always uses aiSidebarWidth.
    expect(shellSrc).not.toContain("w-[min(24rem,42vw)]");
    expect(shellSrc).toContain("style={{ width: aiSidebarWidth }}");
    expect(shellSrc).toContain("ref={aiSidebarRailRef}");
  });

  it("keeps the SN-197 single shared mount and z-layering over the reader", () => {
    expect(shellSrc).toContain("z-[var(--z-companion-rail)]");
    // Still exactly one over-reader companion rail testid.
    const matches = shellSrc.match(/pdf-reader-ai-sidebar/g) ?? [];
    expect(matches.length).toBe(1);
  });
});

describe("SN-161 smooth drag tracking", () => {
  it("both rails write width per animation frame and capture the pointer", () => {
    expect(shellSrc).toContain("requestAnimationFrame(applyWidth)");
    expect(shellSrc).toContain("setPointerCapture(event.pointerId)");
    // The AI rail no longer calls setState on every pointermove.
    expect(shellSrc).not.toContain("setAiSidebarWidth(nextWidth)");
  });
});

describe("SN-161 clamp + persistence unchanged (SN-46 max 80% viewport)", () => {
  it("keeps the shared clamp helpers wired into the resize path", () => {
    expect(shellSrc).toContain("getAiSidebarMaxWidth(window.innerWidth)");
    expect(shellSrc).toContain("clampAiSidebarWidth(window.innerWidth - moveEvent.clientX");
  });

  it("caps width at 80% of the viewport and floors at the min", () => {
    const viewport = 1600;
    const max = getAiSidebarMaxWidth(viewport);
    expect(max).toBe(Math.floor(viewport * AI_SIDEBAR_MAX_VIEWPORT_RATIO));
    // Over-wide drag clamps to the 80% ceiling; under-min clamps up.
    expect(clampAiSidebarWidth(99999, AI_SIDEBAR_MIN_WIDTH, max)).toBe(max);
    expect(clampAiSidebarWidth(10, AI_SIDEBAR_MIN_WIDTH, max)).toBe(AI_SIDEBAR_MIN_WIDTH);
  });
});
