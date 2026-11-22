"use client";

import * as React from "react";
import type { InkEngine, InkScene } from "@/lib/ink-engine";
import { DEFAULT_INK_ENGINE, type AvailableInkEngineId } from "@/lib/ink-engine-preference";
import { TldrawInkSurface } from "@/components/tldraw-ink-adapter";

export interface InkEngineSurfaceProps {
  variant: "annotation" | "note" | "music";
  scene?: InkScene;
  grid?: boolean;
  onMount(engine: InkEngine): void | (() => void);
}

const surfaces: Record<AvailableInkEngineId, React.ComponentType<InkEngineSurfaceProps>> = {
  tldraw: TldrawInkSurface,
};

export function InkEngineSurface({
  engine = DEFAULT_INK_ENGINE,
  ...props
}: InkEngineSurfaceProps & { engine?: AvailableInkEngineId }) {
  const Surface = surfaces[engine];
  return <Surface {...props} />;
}
