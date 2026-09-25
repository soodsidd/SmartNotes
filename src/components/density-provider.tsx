"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type Density = "compact" | "normal" | "comfortable";

type DensityContextValue = {
  density: Density;
  setDensity: (density: Density) => void;
};

const DensityContext = createContext<DensityContextValue | null>(null);

const STORAGE_KEY = "smart-notes-density";

export function resolveInitialDensity(): Density {
  if (typeof window === "undefined") return "normal";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "compact" || stored === "normal" || stored === "comfortable") {
    return stored;
  }
  return "normal";
}

export function applyDensity(density: Density) {
  document.documentElement.dataset.density = density;
}

export function DensityProvider({ children }: { children: ReactNode }) {
  const [density, setDensityState] = useState<Density>("normal");

  useEffect(() => {
    const initial = resolveInitialDensity();
    setDensityState(initial);
    applyDensity(initial);
  }, []);

  const setDensity = (next: Density) => {
    setDensityState(next);
    applyDensity(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  };

  const value = useMemo<DensityContextValue>(
    () => ({ density, setDensity }),
    [density]
  );

  return (
    <DensityContext.Provider value={value}>{children}</DensityContext.Provider>
  );
}

export function useDensity() {
  const ctx = useContext(DensityContext);
  if (!ctx) throw new Error("useDensity must be used within DensityProvider");
  return ctx;
}
