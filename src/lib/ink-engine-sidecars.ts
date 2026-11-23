import { fetchAnnotationsScene, parseAnnotationsSidecarJson, saveAnnotationsScene } from "@/lib/api/annotations";
import { fetchInkScene, parseInkSidecarJson, saveInkScene } from "@/lib/api/ink";
import { PageContentCache, pageContentCache } from "@/lib/page-content-cache";
import type { AvailableInkEngineId } from "@/lib/ink-engine-preference";
import { registerReloadDrain } from "@/lib/reload-guard";

function annotationSidecar(cache: PageContentCache, engine: AvailableInkEngineId) {
  const writes = new Map<string, Promise<void>>();

  return {
    getCached: cache.get.bind(cache),
    load: cache.ensureAnnotations.bind(cache),
    remember: cache.setAnnotations.bind(cache),
    parse: (raw: string) => parseAnnotationsSidecarJson(raw, engine),
    async save(path: string, scene: unknown, drawableBottom?: number) {
      // A PDF sheet can remount during its previous instance's final save.
      const previous = writes.get(path);
      const write = (async () => {
        await previous?.catch(() => undefined);
        await saveAnnotationsScene(path, scene, drawableBottom, engine);
      })();
      writes.set(path, write);
      const unregister = registerReloadDrain(() => write);
      try {
        await write;
      } finally {
        if (writes.get(path) === write) writes.delete(path);
        unregister();
      }
    },
    async flushWrites(ownsPath: (path: string) => boolean) {
      while (true) {
        const pending = Array.from(writes)
          .filter(([path]) => ownsPath(path))
          .map(([, write]) => write);
        if (!pending.length) return;
        await Promise.all(pending);
      }
    },
  };
}

type InkSidecars = {
  note: {
    load: (path: string) => ReturnType<typeof fetchInkScene>;
    parse: (raw: string) => ReturnType<typeof parseInkSidecarJson>;
    save: (path: string, scene: unknown, mode?: Parameters<typeof saveInkScene>[2]) => Promise<void>;
  };
  annotation: ReturnType<typeof annotationSidecar>;
};

const smartNotesCache = new PageContentCache({ loadAnnotations: (path) => fetchAnnotationsScene(path, "smart-notes") });

export const inkSidecars: Record<AvailableInkEngineId, InkSidecars> = {
  tldraw: {
    note: { load: fetchInkScene, parse: parseInkSidecarJson, save: saveInkScene },
    annotation: annotationSidecar(pageContentCache, "tldraw"),
  },
  "smart-notes": {
    note: {
      load: (path) => fetchInkScene(path, "smart-notes"),
      parse: (raw) => parseInkSidecarJson(raw, "smart-notes"),
      save: (path, scene, mode) => saveInkScene(path, scene, mode, "smart-notes"),
    },
    annotation: annotationSidecar(smartNotesCache, "smart-notes"),
  },
};
