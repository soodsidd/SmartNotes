import { parseAnnotationsSidecarJson, saveAnnotationsScene } from "@/lib/api/annotations";
import { fetchInkScene, parseInkSidecarJson, saveInkScene } from "@/lib/api/ink";
import { pageContentCache } from "@/lib/page-content-cache";
import type { AvailableInkEngineId } from "@/lib/ink-engine-preference";

type InkSidecars = {
  note: {
    load: typeof fetchInkScene;
    parse: typeof parseInkSidecarJson;
    save: typeof saveInkScene;
  };
  annotation: {
    getCached: typeof pageContentCache.get;
    load: typeof pageContentCache.ensureAnnotations;
    remember: typeof pageContentCache.setAnnotations;
    parse: typeof parseAnnotationsSidecarJson;
    save: typeof saveAnnotationsScene;
  };
};

// A renderer can be enabled only after it has its own sidecar and cache routing.
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
};
