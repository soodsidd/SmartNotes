import { APP_FRAME_MAX_RESPONSE_BYTES, normalizeVaultRelativePagePath } from "@/lib/app-frame";
import { VaultError } from "./errors";

/**
 * SN-203 companion→app delivery accessor.
 *
 * The socket coordinator that actually broadcasts a companion.deliver request to
 * connected clients and collects their acks lives in the long-running Node server
 * (`server/companion-app-channel.js`) and is published on
 * `globalThis._smartNotesCompanionAppChannel`. This module is the server-side
 * validation + typed entry point used by the `app_send` vault tool; it never
 * queues — a message to an app that is not currently running returns a clear,
 * non-persisting "app not running" result.
 */
export interface CompanionAppChannel {
  deliver(input: { path: string; message: unknown; timeoutMs?: number }): Promise<{
    delivered: boolean;
    instances: number;
    reason?: string;
  }>;
}

export interface CompanionAppSendResult {
  delivered: boolean;
  instances: number;
  path: string;
  hint: string;
}

/** Companion→app messages reuse the app-frame host response size bound. */
export const COMPANION_APP_MESSAGE_MAX_BYTES = APP_FRAME_MAX_RESPONSE_BYTES;

function getCompanionAppChannel(): CompanionAppChannel | null {
  const channel = (globalThis as Record<string, unknown>)["_smartNotesCompanionAppChannel"];
  if (channel && typeof (channel as CompanionAppChannel).deliver === "function") {
    return channel as CompanionAppChannel;
  }
  return null;
}

/**
 * Validate an `app_send` invocation and route it to the socket coordinator.
 * Throws for malformed/oversized input (bounded VaultError); returns a
 * `delivered:false` result — never throws — when no running instance receives it.
 */
export async function deliverCompanionAppMessage(
  rawPath: unknown,
  message: unknown,
  options: { channel?: CompanionAppChannel | null } = {}
): Promise<CompanionAppSendResult> {
  const path = normalizeVaultRelativePagePath(typeof rawPath === "string" ? rawPath : null);
  if (!path) {
    throw new VaultError(
      "INVALID_APP_TARGET",
      "app_send requires a canonical vault-relative App page path.",
      400
    );
  }

  const normalizedMessage = message === undefined ? null : message;
  let serializedBytes = 0;
  try {
    serializedBytes = new TextEncoder().encode(JSON.stringify(normalizedMessage)).byteLength;
  } catch {
    throw new VaultError("INVALID_APP_MESSAGE", "app_send message must be JSON-serializable.", 400);
  }
  if (serializedBytes > COMPANION_APP_MESSAGE_MAX_BYTES) {
    throw new VaultError(
      "APP_MESSAGE_TOO_LARGE",
      "app_send message exceeds the app-frame size bound.",
      400
    );
  }

  const channel = options.channel ?? getCompanionAppChannel();
  if (!channel) {
    return {
      delivered: false,
      instances: 0,
      path,
      hint: "The app messaging channel is not available on this server; the message was not delivered.",
    };
  }

  const result = await channel.deliver({ path, message: normalizedMessage });
  if (result.delivered && result.instances > 0) {
    return {
      delivered: true,
      instances: result.instances,
      path,
      hint: `Delivered to ${result.instances} running instance${result.instances === 1 ? "" : "s"} of the target app.`,
    };
  }

  return {
    delivered: false,
    instances: 0,
    path,
    hint: "app not running: no open instance of the target app received the message. Delivery is ephemeral and was not queued or replayed.",
  };
}
