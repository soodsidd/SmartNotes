import { fetchAnnotationsScene } from "@/lib/api/annotations";
import { countAnnotationShapes, logAnnotationDebug } from "@/lib/annotation-debug";

export interface CachedPageEntry {
  html: string;
  annotationsScene: unknown | null;
  annotationsReady: boolean;
  drawableBottom?: number;
}

export interface PageContentCacheOptions {
  maxEntries?: number;
}

export class PageContentCache {
  private readonly maxEntries: number;
  private readonly entries = new Map<string, CachedPageEntry>();
  private readonly order: string[] = [];
  private readonly inflightAnnotations = new Map<
    string,
    Promise<{ scene: unknown | null; drawableBottom?: number }>
  >();

  constructor(options: PageContentCacheOptions = {}) {
    this.maxEntries = options.maxEntries ?? 24;
  }

  get(path: string): CachedPageEntry | undefined {
    const entry = this.entries.get(path);
    if (!entry) return undefined;
    this.touch(path);
    return entry;
  }

  set(path: string, patch: Partial<CachedPageEntry> & Pick<CachedPageEntry, "html">): CachedPageEntry {
    const existing = this.entries.get(path);
    const next: CachedPageEntry = {
      html: patch.html,
      annotationsScene: patch.annotationsScene ?? existing?.annotationsScene ?? null,
      annotationsReady: patch.annotationsReady ?? existing?.annotationsReady ?? false,
      drawableBottom: patch.drawableBottom ?? existing?.drawableBottom,
    };

    this.entries.set(path, next);
    this.touch(path);
    this.evictIfNeeded();
    return next;
  }

  setAnnotations(path: string, scene: unknown | null, drawableBottom?: number): CachedPageEntry | undefined {
    const existing = this.entries.get(path);
    if (!existing) return undefined;

    const next: CachedPageEntry = {
      ...existing,
      annotationsScene: scene,
      annotationsReady: true,
      drawableBottom: drawableBottom ?? existing.drawableBottom,
    };
    this.entries.set(path, next);
    this.touch(path);
    logAnnotationDebug("cache.annotations.set", {
      path,
      shapeCount: countAnnotationShapes(scene),
    });
    return next;
  }

  hasAnnotations(path: string): boolean {
    return this.entries.get(path)?.annotationsReady === true;
  }

  async ensureAnnotations(
    path: string
  ): Promise<{ scene: unknown | null; drawableBottom?: number }> {
    const cached = this.entries.get(path);
    if (cached?.annotationsReady) {
      this.touch(path);
      logAnnotationDebug("cache.annotations.hit", {
        path,
        shapeCount: countAnnotationShapes(cached.annotationsScene),
        drawableBottom: cached.drawableBottom,
      });
      return { scene: cached.annotationsScene, drawableBottom: cached.drawableBottom };
    }

    const pending = this.inflightAnnotations.get(path);
    if (pending) {
      logAnnotationDebug("cache.annotations.inflight", { path });
      return pending;
    }

    logAnnotationDebug("cache.annotations.miss", { path });
    const request = fetchAnnotationsScene(path)
      .then(({ scene, drawableBottom }) => {
        const sceneValue = scene ?? null;
        if (this.entries.has(path)) {
          this.setAnnotations(path, sceneValue, drawableBottom);
        } else {
          this.entries.set(path, {
            html: "",
            annotationsScene: sceneValue,
            annotationsReady: true,
            drawableBottom,
          });
          this.touch(path);
          this.evictIfNeeded();
        }
        return { scene: sceneValue, drawableBottom };
      })
      .finally(() => {
        this.inflightAnnotations.delete(path);
      });

    this.inflightAnnotations.set(path, request);
    return request;
  }

  clear(): void {
    this.entries.clear();
    this.order.length = 0;
    this.inflightAnnotations.clear();
  }

  private touch(path: string): void {
    const index = this.order.indexOf(path);
    if (index >= 0) {
      this.order.splice(index, 1);
    }
    this.order.push(path);
  }

  private evictIfNeeded(): void {
    while (this.order.length > this.maxEntries) {
      const oldest = this.order.shift();
      if (!oldest) return;
      this.entries.delete(oldest);
      this.inflightAnnotations.delete(oldest);
    }
  }
}

export const pageContentCache = new PageContentCache();
