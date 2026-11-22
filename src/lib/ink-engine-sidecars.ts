import { fetchAnnotationsScene, parseAnnotationsSidecarJson, saveAnnotationsScene } from "@/lib/api/annotations";
import { fetchInkScene, parseInkSidecarJson, saveInkScene } from "@/lib/api/ink";
import { PageContentCache, pageContentCache } from "@/lib/page-content-cache";
import type { AvailableInkEngineId } from "@/lib/ink-engine-preference";

type InkSidecars = {
  note: {
    load: (path: string) => ReturnType<typeof fetchInkScene>;
    parse: (raw: string) => ReturnType<typeof parseInkSidecarJson>;
    save: (path: string, scene: unknown, mode?: Parameters<typeof saveInkScene>[2]) => Promise<void>;
  };
  annotation: {
    getCached: typeof pageContentCache.get;
    load: typeof pageContentCache.ensureAnnotations;
    remember: typeof pageContentCache.setAnnotations;
    parse: (raw: string) => ReturnType<typeof parseAnnotationsSidecarJson>;
    save: (path: string, scene: unknown, drawableBottom?: number) => Promise<void>;
  };
};

const smartNotesCache = new PageContentCache({ loadAnnotations: (path) => fetchAnnotationsScene(path, "smart-notes") });

export const inkSidecars: Record<AvailableInkEngineId, InkSidecars> = {
  tldraw: {
    note: { load: fetchInkScene, parse: parseInkSidecarJson, save: saveInkScene },
    annotation: {
      getCached: pageContentCache.get.bind(pageContentCache),
      load: pageContentCache.ensureAnnotations.bind(pageContentCache),
      remember: pageContentCache.setAnnotations.bind(pageContentCache),
      parse: parseAnnotationsSidecarJson,
      save: saveAnnotationsScene,
    },
  },
  "smart-notes": {
    note: {
      load: (path) => fetchInkScene(path, "smart-notes"),
      parse: (raw) => parseInkSidecarJson(raw, "smart-notes"),
      save: (path, scene, mode) => saveInkScene(path, scene, mode, "smart-notes"),
    },
    annotation: {
      getCached: smartNotesCache.get.bind(smartNotesCache),
      load: smartNotesCache.ensureAnnotations.bind(smartNotesCache),
      remember: smartNotesCache.setAnnotations.bind(smartNotesCache),
      parse: (raw) => parseAnnotationsSidecarJson(raw, "smart-notes"),
      save: (path, scene, bottom) => saveAnnotationsScene(path, scene, bottom, "smart-notes"),
    },
  },
};
