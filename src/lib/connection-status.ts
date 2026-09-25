"use client";

import * as React from "react";

/**
 * Centralized vault-write connection health (SN-85).
 *
 * A module-level singleton store so the "Connection lost" signal survives
 * component remounts and page/tab switches inside the app. Any vault write API
 * call (page save, ink/annotation save, structural mutations) reports its
 * outcome here; the editor top bar subscribes via {@link useConnectionStatus}.
 *
 * The signal is sticky: it is raised on the first failed write and only cleared
 * when a subsequent write succeeds — never automatically on a timer.
 */

export type ConnectionStatus = "ok" | "lost";

export interface ConnectionState {
  status: ConnectionStatus;
  message: string | null;
}

export const CONNECTION_LOST_MESSAGE = "Connection lost — changes may not be saving";

let state: ConnectionState = { status: "ok", message: null };
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) {
    listener();
  }
}

function setState(next: ConnectionState) {
  if (next.status === state.status && next.message === state.message) {
    return;
  }
  state = next;
  emit();
}

/** Record a successful vault write. Clears any outstanding "connection lost" signal. */
export function recordWriteSuccess() {
  setState({ status: "ok", message: null });
}

/** Record a failed vault write (network error or non-2xx). Raises the sticky signal. */
export function recordWriteFailure(message?: string) {
  setState({ status: "lost", message: message ?? CONNECTION_LOST_MESSAGE });
}

export function getConnectionState(): ConnectionState {
  return state;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** React hook returning the current connection state. Re-renders on change. */
export function useConnectionStatus(): ConnectionState {
  return React.useSyncExternalStore(subscribe, getConnectionState, getConnectionState);
}

/**
 * fetch() wrapper for vault write requests. 2xx and 4xx responses clear the
 * connection-lost signal (the server responded, so the connection is alive).
 * 5xx responses and network errors raise the signal. The original
 * Response/throw behaviour is preserved so existing callers keep working.
 */
export async function vaultWriteFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  try {
    const response = await fetch(input, init);
    if (response.ok || response.status < 500) {
      // 2xx success OR 4xx client error — server is reachable
      recordWriteSuccess();
    } else {
      recordWriteFailure();
    }
    return response;
  } catch (error) {
    recordWriteFailure();
    throw error;
  }
}

// Fetch keepalive requests have a browser-wide 64 KiB body quota. Long kept
// companion transcripts can exceed it, causing fetch() to reject before the
// request reaches Smart Notes. Leave a little headroom for another in-flight
// keepalive request and fall back to an ordinary awaited fetch for larger
// payloads.
const KEEPALIVE_BODY_BUDGET_BYTES = 60 * 1024;

export function canUseKeepaliveBody(body: string): boolean {
  return new TextEncoder().encode(body).byteLength <= KEEPALIVE_BODY_BUDGET_BYTES;
}

/** Test-only reset of the singleton store. */
export function __resetConnectionStatusForTests() {
  state = { status: "ok", message: null };
  listeners.clear();
}
