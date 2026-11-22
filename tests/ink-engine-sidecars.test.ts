import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as ink from "@/app/api/ink/route";
import * as annotations from "@/app/api/annotations/route";
import { createPage, deletePage, renamePage } from "@/server/vault/pages";
import { parseAnnotationsSidecarJson } from "@/lib/api/annotations";
import { parseInkSidecarJson } from "@/lib/api/ink";
import { extractAnnotationVerticalRanges } from "@/lib/collapsible-headings";
import { strokeGeometry } from "@/lib/ink-engine/geometry";
import type { SmartNotesInkScene } from "@/lib/ink-engine/scene";

const v2: SmartNotesInkScene = {
  version: 2,
  strokes: [{ id: "new-ink", points: [[40, 50, 0.75]], color: "blue", size: "m", createdAt: 1 }],
};
const legacy = { document: { store: { old: { typeName: "shape", type: "draw" } } } };

const variants = [
  { route: ink, url: "/api/ink", legacySuffix: ".ink.json", smartSuffix: ".sn-ink.json", meta: { backgroundMode: "grid" } },
  { route: annotations, url: "/api/annotations", legacySuffix: ".annotations.json", smartSuffix: ".sn-annotations.json", meta: { drawableBottom: 1300 } },
] as const;

describe("Smart Notes sidecars", () => {
  it.each(variants)("isolates the two scene files through $url and follows page rename and delete", async ({ route, url, legacySuffix, smartSuffix, meta }) => {
    const previousVault = process.env.SMART_NOTES_VAULT;
    const vault = await fs.mkdtemp(path.join(os.tmpdir(), "smart-notes-engine-"));
    process.env.SMART_NOTES_VAULT = vault;
    try {
      await fs.mkdir(path.join(vault, "Notebook", "Section"), { recursive: true });
      const { path: pagePath } = await createPage({ sectionPath: "Notebook/Section", title: "Ink sidecars" });
      const endpoint = `http://localhost${url}`;
      const query = `${endpoint}?path=${encodeURIComponent(pagePath)}`;
      const sidecar = (suffix: string) => path.join(vault, pagePath.replace(/\.html$/i, suffix));
      const save = (data: Record<string, unknown>) => route.PUT(new Request(endpoint, {
        method: "PUT", body: JSON.stringify({ path: pagePath, ...data }),
      }));

      expect((await save({ scene: legacy })).status).toBe(200);
      const legacyFile = await fs.readFile(sidecar(legacySuffix), "utf8");
      expect(await (await route.GET(new Request(`${query}&engine=smart-notes`))).json()).toMatchObject({ scene: null });
      expect((await save({ engine: "smart-notes", scene: legacy })).status).toBe(400);
      expect((await save({ engine: "unknown", scene: v2 })).status).toBe(400);
      expect((await save({ scene: v2 })).status).toBe(400);
      expect((await save({ engine: "smart-notes", scene: v2, ...meta })).status).toBe(200);

      expect(await fs.readFile(sidecar(legacySuffix), "utf8")).toBe(legacyFile);
      expect(await (await route.GET(new Request(query))).json()).toMatchObject({ scene: legacy });
      expect(await (await route.GET(new Request(`${query}&engine=smart-notes`))).json()).toEqual({ scene: v2, ...meta });
      const smartFile = await fs.readFile(sidecar(smartSuffix), "utf8");
      expect(JSON.parse(smartFile).scene).toEqual(v2);

      const renamed = await renamePage(pagePath, "Renamed ink sidecars");
      const renamedSmartFile = path.join(vault, renamed.path.replace(/\.html$/i, smartSuffix));
      expect(await fs.readFile(renamedSmartFile, "utf8")).toBe(smartFile);
      await expect(fs.stat(sidecar(smartSuffix))).rejects.toMatchObject({ code: "ENOENT" });
      await deletePage(renamed.path);
      await expect(fs.stat(renamedSmartFile)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      if (previousVault === undefined) delete process.env.SMART_NOTES_VAULT;
      else process.env.SMART_NOTES_VAULT = previousVault;
      await fs.rm(vault, { recursive: true, force: true });
    }
  });

  it("keeps legacy snapshot payloads out of Smart Notes preview and uses painted bounds in the collapse guard", () => {
    expect(parseInkSidecarJson(JSON.stringify({ scene: legacy, inkMeta: { backgroundMode: "grid" } }), "smart-notes"))
      .toEqual({ scene: null, backgroundMode: "blank" });
    expect(parseAnnotationsSidecarJson(JSON.stringify({ scene: legacy, drawableBottom: 800 }), "smart-notes"))
      .toEqual({ scene: null });
    expect(parseAnnotationsSidecarJson(JSON.stringify({ scene: v2, drawableBottom: 800 }), "smart-notes"))
      .toEqual({ scene: v2, drawableBottom: 800 });
    const { top, bottom } = strokeGeometry(v2.strokes[0]).bounds;
    expect(extractAnnotationVerticalRanges(v2)).toEqual([{ minY: top, maxY: bottom }]);
  });
});
