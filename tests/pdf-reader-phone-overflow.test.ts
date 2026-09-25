/**
 * SN-246: phone-width PDF reader chrome overflow contract.
 * Secondary/new controls must fold into the More menu at ≤640px so Annotate
 * and outline stay reachable on the bar.
 */
describe("pdf reader phone overflow chrome", () => {
  const css = require("fs").readFileSync(
    require("path").join(__dirname, "..", "src", "app", "globals.css"),
    "utf8"
  ) as string;
  const reader = require("fs").readFileSync(
    require("path").join(__dirname, "..", "src", "components", "immersive-pdf-reader.tsx"),
    "utf8"
  ) as string;

  test("marks secondary controls for phone menu overflow", () => {
    expect(reader).toContain('pdf-reader__control--menu-phone');
    expect(reader).toContain('data-testid="pdf-reader-more-menu"');
    expect(reader).toContain('data-testid="pdf-reader-more-spread"');
    expect(reader).toContain('data-testid="pdf-reader-more-performance"');
    expect(reader).toContain('data-testid="pdf-reader-more-night"');
    expect(reader).toContain('positionerClassName="z-[400]"');
    expect(reader).toMatch(
      /pdf-reader__spread-toggle[^"]*pdf-reader__control--menu-phone|pdf-reader__control--menu-phone[^"]*pdf-reader__spread-toggle/
    );
    expect(reader).toMatch(
      /pdf-reader__performance-toggle[^"]*pdf-reader__control--menu-phone|pdf-reader__control--menu-phone[^"]*pdf-reader__performance-toggle/
    );
    expect(reader).toMatch(
      /pdf-reader__night-toggle[^"]*pdf-reader__control--menu-phone|pdf-reader__control--menu-phone[^"]*pdf-reader__night-toggle/
    );
    expect(reader).not.toMatch(/pdf-reader__annotate-toggle[^"]*menu-phone/);
    expect(reader).not.toMatch(/pdf-reader__outline-toggle[^"]*menu-phone/);
  });

  test("shows More menu only at phone width and hides menu-phone controls", () => {
    expect(css).toMatch(/\.pdf-reader__more-menu\s*\{\s*display:\s*none;/);
    expect(css).toMatch(
      /@media \(max-width:\s*640px\)\s*\{[\s\S]*\.pdf-reader__control--menu-phone[\s\S]*display:\s*none;[\s\S]*\.pdf-reader__more-menu[\s\S]*display:\s*inline-flex;/
    );
  });

  test("hidden reader bar leaves the flex flow so no blank toolbar frame remains", () => {
    expect(css).toMatch(
      /\.pdf-reader__bar\[data-hidden="true"\]\s*\{[\s\S]*position:\s*absolute;[\s\S]*transform:\s*translateY\(-100%\);/
    );
  });
});
