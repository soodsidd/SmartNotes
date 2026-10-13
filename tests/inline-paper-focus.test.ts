/** @jest-environment jsdom */
import { isInlinePaperFocusEscape } from "@/lib/paper-reference-extension";

// SN-294: typing meant for an inline paper must never land in the referring page.
describe("inline paper focus containment", () => {
  const build = () => {
    const outer = document.createElement("div");
    outer.className = "ProseMirror";
    const chip = document.createElement("div");
    chip.contentEditable = "false";
    const inner = document.createElement("div");
    inner.className = "ProseMirror";
    const innerText = document.createElement("p");
    inner.appendChild(innerText);
    chip.appendChild(inner);
    outer.appendChild(chip);
    const button = document.createElement("button");
    document.body.append(outer, button);
    return { outer, inner, innerText, button };
  };

  it("treats a keyboard-driven focus move into the referring editor as an escape", () => {
    const { outer, inner, innerText } = build();
    expect(isInlinePaperFocusEscape(inner, outer, null, 10_000, 0)).toBe(true);
    expect(isInlinePaperFocusEscape(inner, outer, inner, 10_000, 0)).toBe(true);
    expect(isInlinePaperFocusEscape(inner, outer, innerText, 10_000, 0)).toBe(true);
  });

  it("allows deliberate focus changes", () => {
    const { outer, inner, button } = build();
    expect(isInlinePaperFocusEscape(inner, outer, null, 10_000, 9_800)).toBe(false); // pointer click into the page
    expect(isInlinePaperFocusEscape(inner, outer, button, 10_000, 0)).toBe(false); // focus arriving from elsewhere
    expect(isInlinePaperFocusEscape(inner, inner, null, 10_000, 0)).toBe(false);
    expect(isInlinePaperFocusEscape(inner, button, inner, 10_000, 0)).toBe(false); // Tab to Save/Collapse
    const unrelated = document.createElement("div");
    unrelated.className = "ProseMirror";
    document.body.appendChild(unrelated);
    expect(isInlinePaperFocusEscape(inner, unrelated, inner, 10_000, 0)).toBe(false);
  });
});
