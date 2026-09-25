/**
 * @jest-environment node
 */

import fs from "fs";
import path from "path";

describe("PWA manifest", () => {
  it("ships standalone metadata with 192px and 512px icons", () => {
    const manifestPath = path.resolve(__dirname, "../public/manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

    expect(manifest.id).toBe("/?source=pwa");
    expect(manifest.start_url).toBe("/?source=pwa");
    expect(manifest.display).toBe("standalone");
    expect(manifest.theme_color).toBe("#0b0d10");
    expect(manifest.background_color).toBe("#0b0d10");
    expect(manifest.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          src: "/icon-192.png",
          sizes: "192x192",
          type: "image/png",
        }),
        expect.objectContaining({
          src: "/icon-512.png",
          sizes: "512x512",
          type: "image/png",
        }),
      ])
    );
  });
});
