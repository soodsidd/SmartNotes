import {
  isVaultRefreshPayloadStale,
  rebaseDraftAfterSave,
  resolveAttachmentDraftContent,
} from "@/lib/page-reload";
import { createSerialTaskQueue } from "@/lib/rich-text-editor-config";

const CHIP_A = "/vault/AI/p.assets/a.pdf";
const CHIP_B = "/vault/AI/p.assets/MR_copy.pdf";

describe("SN-283 attachment vs live tree refresh race", () => {
  it("discards a focus-refresh payload when an attach save landed mid-fetch", () => {
    const started = { draftEpoch: 4, lastSavedSnapshot: "before-attach" };
    // Upload finished, chip inserted and durably saved while the tree fetch ran.
    expect(
      isVaultRefreshPayloadStale(started, {
        draftEpoch: 5,
        lastSavedSnapshot: "with-chip",
        canAutoRefresh: true,
      })
    ).toBe(true);
    // Save still in flight / timer armed.
    expect(
      isVaultRefreshPayloadStale(started, { ...started, canAutoRefresh: false })
    ).toBe(true);
    // Edit without save yet.
    expect(
      isVaultRefreshPayloadStale(started, { ...started, draftEpoch: 5, canAutoRefresh: true })
    ).toBe(true);
  });

  it("applies a refresh payload when nothing changed during the fetch", () => {
    const started = { draftEpoch: 4, lastSavedSnapshot: "s" };
    expect(isVaultRefreshPayloadStale(started, { ...started, canAutoRefresh: true })).toBe(false);
  });

  it("documents the clobber the fence prevents: stale rehydrate survives rebase", () => {
    const stale = { path: "p", title: "t", content: `<p>${CHIP_A}</p>` };
    const saved = { path: "p", title: "t", content: `<p>${CHIP_A}${CHIP_B}</p>` };
    // Without the fence the queued save would persist the stale body.
    expect(rebaseDraftAfterSave(stale, saved).content).not.toContain(CHIP_B);
  });

  it("does not overwrite a draft that already holds the chip with the insert-time snapshot", () => {
    const live = `<p>${CHIP_A}${CHIP_B}</p><p>typed after insert</p>`;
    expect(resolveAttachmentDraftContent(live, `<p>${CHIP_A}${CHIP_B}</p>`, CHIP_B)).toBeNull();
    expect(resolveAttachmentDraftContent(`<p>${CHIP_A}</p>`, `<p>${CHIP_A}${CHIP_B}</p>`, CHIP_B)).toBe(
      `<p>${CHIP_A}${CHIP_B}</p>`
    );
  });

  it("serializes overlapping attaches and keeps going after a failure", async () => {
    const enqueue = createSerialTaskQueue();
    const log: string[] = [];
    const task = (name: string, ms: number, fail = false) => () =>
      new Promise<string>((resolve, reject) => {
        log.push(`start:${name}`);
        setTimeout(() => {
          log.push(`end:${name}`);
          fail ? reject(new Error(name)) : resolve(name);
        }, ms);
      });
    const a = enqueue(task("a", 30, true));
    const b = enqueue(task("b", 5));
    await expect(a).rejects.toThrow("a");
    await expect(b).resolves.toBe("b");
    expect(log).toEqual(["start:a", "end:a", "start:b", "end:b"]);
  });
});
