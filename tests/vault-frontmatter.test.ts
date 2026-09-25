import { parseFrontmatterDocument, serializeFrontmatterDocument } from "@/server/vault/frontmatter";

describe("frontmatter", () => {
  it("parses and reserializes known and unknown metadata fields", () => {
    const source = `---
title: Maxwell Lens Notes
created: 2026-05-25T18:12:00Z
updated: 2026-05-25T18:15:21Z
tags:
  - optics
  - ideas
source:
  kind: manual
---
# Body

Saved note content.
`;

    const parsed = parseFrontmatterDocument(source);
    expect(parsed.metadata.title).toBe("Maxwell Lens Notes");
    expect(parsed.metadata.tags).toEqual(["optics", "ideas"]);
    expect(parsed.metadata.source).toEqual({ kind: "manual" });

    const roundTrip = parseFrontmatterDocument(
      serializeFrontmatterDocument(parsed.metadata, parsed.body)
    );
    expect(roundTrip.metadata).toEqual(parsed.metadata);
    expect(roundTrip.body).toBe(parsed.body);
  });

  it("rejects malformed frontmatter", () => {
    expect(() =>
      parseFrontmatterDocument(`---
title: Broken
body: nope`)
    ).toThrow("terminating --- line");
  });
});
