import { normalizeVaultRelativePagePath } from "@/lib/app-frame";
import type { WorkspaceStateRequest } from "@/server/jupyter/workspace-state";
import {
  capabilityProjectRequest,
  resolveWorkspaceCapability,
} from "@/server/jupyter/workspace-capability";
import { VaultError } from "@/server/vault/errors";

export function workspaceRequestFromValue(value: unknown): WorkspaceStateRequest {
  const capability = resolveWorkspaceCapability(value);
  return {
    ...capabilityProjectRequest(capability),
    workItemId: capability.workItemId,
  };
}

export function workspaceStorePathFromRequest(request: Request): string {
  const value = new URL(request.url).searchParams.get("workspace");
  if (!value) throw new VaultError("INVALID_WORKSPACE_IDENTITY", 'Query parameter "workspace" is required.');
  return value;
}

/**
 * Fast-lane session identity may be a canonical vault page or an opaque Deep
 * Work address. Absolute roots are never accepted as vault paths.
 */
export async function resolveJupyterOwnerPath(value: unknown): Promise<string | null> {
  if (typeof value === "string" && value.startsWith("dwc_")) {
    resolveWorkspaceCapability(value);
    return value;
  }
  if (typeof value === "string" && value.startsWith("deep-work:")) return null;
  return normalizeVaultRelativePagePath(value);
}
