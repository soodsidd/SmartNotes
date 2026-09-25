"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type SpellcheckContextValue = {
  spellcheckEnabled: boolean;
  setSpellcheckEnabled: (enabled: boolean) => void;
};

const SpellcheckContext = createContext<SpellcheckContextValue | null>(null);

export const SPELLCHECK_STORAGE_KEY = "smart-notes-spellcheck";

export function resolveInitialSpellcheck(): boolean {
  if (typeof window === "undefined") return true;
  const stored = window.localStorage.getItem(SPELLCHECK_STORAGE_KEY);
  if (stored === "false") return false;
  if (stored === "true") return true;
  return true;
}

export function SpellcheckProvider({ children }: { children: ReactNode }) {
  const [spellcheckEnabled, setSpellcheckEnabledState] = useState(true);

  useEffect(() => {
    setSpellcheckEnabledState(resolveInitialSpellcheck());
  }, []);

  const setSpellcheckEnabled = (enabled: boolean) => {
    setSpellcheckEnabledState(enabled);
    window.localStorage.setItem(SPELLCHECK_STORAGE_KEY, enabled ? "true" : "false");
  };

  const value = useMemo<SpellcheckContextValue>(
    () => ({ spellcheckEnabled, setSpellcheckEnabled }),
    [spellcheckEnabled]
  );

  return (
    <SpellcheckContext.Provider value={value}>{children}</SpellcheckContext.Provider>
  );
}

export function useSpellcheck() {
  const ctx = useContext(SpellcheckContext);
  if (!ctx) throw new Error("useSpellcheck must be used within SpellcheckProvider");
  return ctx;
}

/** Defaults to on when no provider (isolated editor tests / SSR). */
export function useSpellcheckEnabled(): boolean {
  const ctx = useContext(SpellcheckContext);
  return ctx?.spellcheckEnabled ?? true;
}
