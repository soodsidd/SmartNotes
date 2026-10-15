/**
 * SN-318: main editor flow column width — clamp, frontmatter round-trip, export.
 */
import {
  MAIN_FLOW_DEFAULT_WIDTH,
  MAIN_FLOW_MAX_WIDTH,
  MAIN_FLOW_MIN_WIDTH,
  MAIN_FLOW_WIDTH_METADATA_KEY,
  applyMainFlowWidthMetadata,
  isDefaultMainFlowWidth,
  mainFlowWidthFromMetadata,
  normalizeMainFlowWidth,
  resizeMainFlowWidth,
} from "@/lib/main-flow-width";
import { buildStandaloneHtmlBundle } from "@/lib/page-export";

describe("main flow width", () => {
  it("defaults to the 672px column and clamps to the documented range", () => {
    expect(MAIN_FLOW_DEFAULT_WIDTH).toBe(672);
    expect(normalizeMainFlowWidth(undefined)).toBe(672);
    expect(normalizeMainFlowWidth("wide")).toBe(672);
    expect(normalizeMainFlowWidth(Number.NaN)).toBe(672);
    expect(normalizeMainFlowWidth(812.6)).toBe(813);
    expect(normalizeMainFlowWidth("900")).toBe(900);
    expect(normalizeMainFlowWidth(10)).toBe(MAIN_FLOW_MIN_WIDTH);
    expect(normalizeMainFlowWidth(99999)).toBe(MAIN_FLOW_MAX_WIDTH);
  });

  it("resizes width only and stops at the clamps", () => {
    expect(resizeMainFlowWidth(672, 128)).toBe(800);
    expect(resizeMainFlowWidth(672, -200)).toBe(472);
    expect(resizeMainFlowWidth(400, -500)).toBe(MAIN_FLOW_MIN_WIDTH);
    expect(resizeMainFlowWidth(1150, 500)).toBe(MAIN_FLOW_MAX_WIDTH);
  });

  it("round-trips through frontmatter and omits the default", () => {
    const base: Record<string, unknown> = { title: "Page", page_lines: { style: "rule-wide", color: "blue" } };
    const wide = applyMainFlowWidthMetadata(base, 900);
    expect(wide[MAIN_FLOW_WIDTH_METADATA_KEY]).toBe(900);
    expect(wide.page_lines).toEqual(base.page_lines);
    expect(mainFlowWidthFromMetadata(wide)).toBe(900);

    const reset = applyMainFlowWidthMetadata(wide, 672);
    expect(MAIN_FLOW_WIDTH_METADATA_KEY in reset).toBe(false);
    expect(mainFlowWidthFromMetadata(reset)).toBe(672);
    expect(mainFlowWidthFromMetadata(null)).toBe(672);
    expect(mainFlowWidthFromMetadata({ main_flow_width: 5000 })).toBe(MAIN_FLOW_MAX_WIDTH);
    expect(isDefaultMainFlowWidth(672)).toBe(true);
    expect(isDefaultMainFlowWidth(673)).toBe(false);
  });

  it("exports a custom column width and leaves the default export unchanged", () => {
    const input = { title: "Wide", bodyHtml: "<p>Body</p>", frameHeight: 400 };
    const stock = buildStandaloneHtmlBundle(input);
    expect(buildStandaloneHtmlBundle({ ...input, mainFlowWidth: 672 })).toBe(stock);
    expect(stock).toContain('<article class="exported-page">');

    const wide = buildStandaloneHtmlBundle({ ...input, mainFlowWidth: 960 });
    expect(wide).toContain(
      '<article class="exported-page" data-main-flow-width="960" style="--editor-main-flow-width:960px;max-width:max(760px, 960px)">'
    );
    expect(wide).toContain(
      '.exported-page[data-main-flow-width] .exported-page__content > :not([data-type="floating-text-box"])'
    );
    expect(buildStandaloneHtmlBundle({ ...input, mainFlowWidth: 5 })).toContain('data-main-flow-width="360"');
  });
});
