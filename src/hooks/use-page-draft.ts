"use client";

import * as React from "react";
import {
  fetchPage,
  savePage as persistPage,
  type VaultPageDocument,
} from "@/lib/api/pages";

export type SaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";

export interface PageDraftState {
  page: VaultPageDocument | null;
  title: string;
  body: string;
  saveStatus: SaveStatus;
  errorMessage: string | null;
  isLoading: boolean;
  setTitle: (title: string) => void;
  setBody: (body: string) => void;
  flush: () => Promise<VaultPageDocument | null>;
  reload: () => Promise<void>;
}

interface DraftBaseline {
  path: string;
  title: string;
  body: string;
}

export function usePageDraft(selectedPagePath: string | null): PageDraftState {
  const [page, setPage] = React.useState<VaultPageDocument | null>(null);
  const [title, setTitleState] = React.useState("");
  const [body, setBodyState] = React.useState("");
  const [saveStatus, setSaveStatus] = React.useState<SaveStatus>("idle");
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState(false);

  const baselineRef = React.useRef<DraftBaseline | null>(null);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = React.useRef<Promise<VaultPageDocument | null> | null>(null);
  const latestRef = React.useRef({ title: "", body: "" });
  const selectedPathRef = React.useRef<string | null>(null);
  const savedToastTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = React.useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    if (savedToastTimerRef.current) {
      clearTimeout(savedToastTimerRef.current);
      savedToastTimerRef.current = null;
    }
  }, []);

  const load = React.useCallback(async () => {
    clearTimers();
    selectedPathRef.current = selectedPagePath;

    if (!selectedPagePath) {
      baselineRef.current = null;
      setPage(null);
      setTitleState("");
      setBodyState("");
      setSaveStatus("idle");
      setErrorMessage(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    try {
      const nextPage = await fetchPage(selectedPagePath);
      baselineRef.current = {
        path: nextPage.path,
        title: nextPage.title,
        body: nextPage.body,
      };
      latestRef.current = {
        title: nextPage.title,
        body: nextPage.body,
      };
      setPage(nextPage);
      setTitleState(nextPage.title);
      setBodyState(nextPage.body);
      setSaveStatus("idle");
    } catch (error) {
      baselineRef.current = null;
      setPage(null);
      setSaveStatus("error");
      setErrorMessage(error instanceof Error ? error.message : "Failed to load page.");
    } finally {
      setIsLoading(false);
    }
  }, [clearTimers, selectedPagePath]);

  React.useEffect(() => {
    void load();
    return clearTimers;
  }, [clearTimers, load]);

  const isDirty = React.useCallback(() => {
    const baseline = baselineRef.current;
    if (!baseline) {
      return false;
    }

    return (
      latestRef.current.title !== baseline.title ||
      latestRef.current.body !== baseline.body
    );
  }, []);

  const commitSavedState = React.useCallback((savedPage: VaultPageDocument) => {
    baselineRef.current = {
      path: savedPage.path,
      title: savedPage.title,
      body: savedPage.body,
    };
    latestRef.current = {
      title: savedPage.title,
      body: savedPage.body,
    };
    setPage(savedPage);
    setTitleState(savedPage.title);
    setBodyState(savedPage.body);
    setSaveStatus("saved");
    savedToastTimerRef.current = setTimeout(() => {
      setSaveStatus("idle");
    }, 1200);
  }, []);

  const flush = React.useCallback(async () => {
    if (!selectedPathRef.current || !baselineRef.current) {
      return null;
    }

    if (inFlightRef.current) {
      await inFlightRef.current;
      if (isDirty()) {
        return flush();
      }
      return page;
    }

    if (!isDirty()) {
      return page;
    }

    clearTimers();
    setSaveStatus("saving");
    setErrorMessage(null);

    const currentPath = baselineRef.current.path;
    const pendingDraft = {
      title: latestRef.current.title,
      body: latestRef.current.body,
    };
    const pendingWrite = persistPage(
      currentPath,
      pendingDraft.title,
      pendingDraft.body
    )
      .then((savedPage) => {
        baselineRef.current = {
          path: savedPage.path,
          title: savedPage.title,
          body: savedPage.body,
        };
        setPage(savedPage);

        const changedDuringSave =
          latestRef.current.title !== pendingDraft.title ||
          latestRef.current.body !== pendingDraft.body;

        if (changedDuringSave) {
          setSaveStatus("dirty");
          return savedPage;
        }

        commitSavedState(savedPage);
        return savedPage;
      })
      .catch((error) => {
        setSaveStatus("error");
        setErrorMessage(error instanceof Error ? error.message : "Failed to save page.");
        throw error;
      })
      .finally(() => {
        inFlightRef.current = null;
      });

    inFlightRef.current = pendingWrite;
    return pendingWrite;
  }, [clearTimers, commitSavedState, isDirty, page]);

  React.useEffect(() => {
    if (saveStatus !== "dirty") {
      return;
    }

    timerRef.current = setTimeout(() => {
      void flush().catch(() => undefined);
    }, 1200);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [flush, saveStatus]);

  const updateDraft = React.useCallback(
    (nextTitle: string, nextBody: string) => {
      latestRef.current = {
        title: nextTitle,
        body: nextBody,
      };
      setErrorMessage(null);
      setSaveStatus(baselineRef.current ? "dirty" : "idle");
    },
    []
  );

  const setTitle = React.useCallback(
    (nextTitle: string) => {
      setTitleState(nextTitle);
      updateDraft(nextTitle, latestRef.current.body);
    },
    [updateDraft]
  );

  const setBody = React.useCallback(
    (nextBody: string) => {
      setBodyState(nextBody);
      updateDraft(latestRef.current.title, nextBody);
    },
    [updateDraft]
  );

  return {
    page,
    title,
    body,
    saveStatus,
    errorMessage,
    isLoading,
    setTitle,
    setBody,
    flush,
    reload: load,
  };
}
