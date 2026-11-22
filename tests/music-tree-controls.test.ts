import fs from "node:fs";
import path from "node:path";

const source = fs.readFileSync(
  path.resolve(__dirname, "../src/components/notebook-shell-reliable.tsx"),
  "utf8"
);

function buttonAround(testId: string) {
  const markerIndex = source.indexOf(testId);
  expect(markerIndex).toBeGreaterThan(-1);
  return source.slice(source.lastIndexOf("<button", markerIndex), source.indexOf("</button>", markerIndex));
}

describe("music page tree controls", () => {
  it("creates a child music page from the page right-click menu", () => {
    const buttonSource = buttonAround("page-context-create-music-${pageContextMenu.pagePath}");
    expect(buttonSource).toContain("onCreateMusicPage({");
    expect(buttonSource).toContain("parentId: pageContextMenu.pagePath");
    expect(buttonSource).toContain("sectionPath: pageContextMenu.sectionPath ?? null");
    expect(buttonSource).toContain("New child music page");
  });

  it("creates a music page from the page-pane blank-area menu", () => {
    const buttonSource = buttonAround('data-testid="blank-menu-new-music"');
    expect(buttonSource).toContain("onCreateMusicPage(scopedCreateTarget)");
    expect(buttonSource).toContain("New music page");
  });
});
