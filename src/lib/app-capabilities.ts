import { APP_MANIFEST_VERSION, APP_RPC_OPERATIONS } from "@/lib/app-contract";

export const APP_PAGES_CAPABILITY_ID = "smart-notes.app-pages" as const;
export const APP_PAGES_CAPABILITY_VERSION = 2 as const;

export function appPagesCapability() {
  return {
    capability: APP_PAGES_CAPABILITY_ID,
    version: APP_PAGES_CAPABILITY_VERSION,
    manifestVersion: APP_MANIFEST_VERSION,
    rpcOperations: [...APP_RPC_OPERATIONS],
  };
}
