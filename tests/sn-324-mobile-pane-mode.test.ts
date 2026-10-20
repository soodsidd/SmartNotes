/**
 * @jest-environment jsdom
 *
 * SN-324 — mobile rotate model: pane-mode persistence
 * Tests readMobilePaneMode / writeMobilePaneMode and the MOBILE_PANE_MODE_KEY contract.
 */

import { readMobilePaneMode, writeMobilePaneMode, MOBILE_PANE_MODE_KEY } from "@/lib/app-settings";

afterEach(() => window.localStorage.clear());

describe("mobile pane mode persistence (SN-324)", () => {
  it("defaults to page-tree when nothing is stored", () => {
    expect(readMobilePaneMode()).toBe("page-tree");
  });

  it("returns rail when rail is stored", () => {
    window.localStorage.setItem(MOBILE_PANE_MODE_KEY, "rail");
    expect(readMobilePaneMode()).toBe("rail");
  });

  it("returns page-tree when page-tree is stored", () => {
    window.localStorage.setItem(MOBILE_PANE_MODE_KEY, "page-tree");
    expect(readMobilePaneMode()).toBe("page-tree");
  });

  it("returns page-tree for unknown stored value", () => {
    window.localStorage.setItem(MOBILE_PANE_MODE_KEY, "unknown");
    expect(readMobilePaneMode()).toBe("page-tree");
  });

  it("writeMobilePaneMode stores rail", () => {
    writeMobilePaneMode("rail");
    expect(window.localStorage.getItem(MOBILE_PANE_MODE_KEY)).toBe("rail");
    expect(readMobilePaneMode()).toBe("rail");
  });

  it("writeMobilePaneMode stores page-tree", () => {
    writeMobilePaneMode("page-tree");
    expect(window.localStorage.getItem(MOBILE_PANE_MODE_KEY)).toBe("page-tree");
    expect(readMobilePaneMode()).toBe("page-tree");
  });

  it("write then overwrite returns new value", () => {
    writeMobilePaneMode("rail");
    writeMobilePaneMode("page-tree");
    expect(readMobilePaneMode()).toBe("page-tree");
  });
});
