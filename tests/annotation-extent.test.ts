import { computeDrawableBottomFromSnapshot } from "@/lib/annotation-extent";
import { AUTO_GROW_BOTTOM_MARGIN_PX } from "@/lib/page-frame";

describe("annotation sidecar extent", () => {
  const snapshot = {
    document: {
      store: {
        shape1: {
          typeName: "shape",
          type: "draw",
          y: 100,
          props: {
            segments: [{ points: [{ x: 0, y: 0 }, { x: 10, y: 250 }] }],
          },
        },
      },
    },
  };

  test("derives drawableBottom a full default margin below the lowest stroke", () => {
    expect(computeDrawableBottomFromSnapshot(snapshot)).toBe(
      100 + 250 + AUTO_GROW_BOTTOM_MARGIN_PX
    );
  });

  test("honors a viewport-scaled margin so the canvas extends past the last stroke", () => {
    const margin = 900;
    expect(computeDrawableBottomFromSnapshot(snapshot, margin)).toBe(100 + 250 + margin);
  });

  test("returns undefined when there is no ink", () => {
    expect(computeDrawableBottomFromSnapshot({ document: { store: {} } })).toBeUndefined();
  });

  test("accepts raw TLStoreSnapshot shape (store at top level)", () => {
    expect(
      computeDrawableBottomFromSnapshot({
        store: snapshot.document.store,
        schema: { schemaVersion: 2, sequences: {} },
      })
    ).toBe(100 + 250 + AUTO_GROW_BOTTOM_MARGIN_PX);
  });
});
