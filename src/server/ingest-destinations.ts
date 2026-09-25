import fs from "node:fs";
import path from "node:path";
import { getAppStateDir } from "@/server/app-state";
import { VaultError } from "@/server/vault/errors";
import { toVaultRelativePath } from "@/server/vault/paths";

export const INGEST_DESTINATIONS_ENV = "SMART_NOTES_INGEST_DESTINATIONS";
export const INGEST_DEFAULT_DESTINATION_ENV = "SMART_NOTES_INGEST_DEFAULT_DESTINATION";
export const INGEST_DESTINATIONS_SETTINGS_FILENAME = "ingest-destinations-settings.json";

/**
 * A single operator-configured ingest target. `notebookPath` is a vault-relative
 * notebook directory name (primary or registered portable) and never leaves the
 * server: the public catalog exposes `id` + `label` only.
 */
export interface IngestDestination {
  id: string;
  label: string;
  notebookPath: string;
}

/** Public, token-gated catalog shape returned by GET /api/ingest/destinations. */
export interface IngestDestinationCatalogEntry {
  id: string;
  label: string;
  isDefault: boolean;
}

export interface IngestDestinationCatalog {
  destinations: IngestDestination[];
  defaultId?: string;
}

/** Settings-store shape persisted to {@link INGEST_DESTINATIONS_SETTINGS_FILENAME}. */
export interface IngestDestinationsSettings {
  destinations: IngestDestination[];
  defaultId: string | null;
}

export interface RequestedIngestDestination {
  id?: string;
  notebookPath?: string;
  sectionPath?: string;
}

export interface ResolvedIngestDestination {
  entry: IngestDestination;
  /** Present only when the caller asked for a section inside the allowlisted notebook. */
  sectionPath?: string;
}

function configError(message: string) {
  // 503, not 500: the route is healthy, the deployment is unconfigured. Mirrors
  // the POST /api/email/inbound missing-configuration contract.
  return new VaultError("INGEST_DESTINATIONS_NOT_CONFIGURED", message, 503);
}

function normalizeNotebookPath(value: string) {
  return toVaultRelativePath(value).trim().replace(/\/+$/, "");
}

function comparableNotebookPath(value: string) {
  return normalizeNotebookPath(value).toLowerCase();
}

function requireString(raw: Record<string, unknown>, field: string, index: number) {
  const value = raw[field];
  if (typeof value !== "string" || !value.trim()) {
    throw configError(`${INGEST_DESTINATIONS_ENV}[${index}] is missing a non-empty "${field}".`);
  }
  return value.trim();
}

/**
 * Parse the allowlist from its configured JSON-array form. Malformed
 * configuration throws instead of silently dropping entries — a half-parsed
 * allowlist is an availability problem the operator needs to see, and silently
 * shrinking an allowlist is exactly how an unlisted default sneaks back in.
 */
export function parseIngestDestinations(value: string | undefined): IngestDestination[] {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw configError(`${INGEST_DESTINATIONS_ENV} must be a JSON array of { id, label, notebookPath }.`);
  }
  if (!Array.isArray(parsed)) {
    throw configError(`${INGEST_DESTINATIONS_ENV} must be a JSON array of { id, label, notebookPath }.`);
  }

  const seen = new Set<string>();
  return parsed.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw configError(`${INGEST_DESTINATIONS_ENV}[${index}] must be an object.`);
    }
    const record = item as Record<string, unknown>;
    const id = requireString(record, "id", index);
    const label = requireString(record, "label", index);
    const notebookPath = normalizeNotebookPath(requireString(record, "notebookPath", index));

    const segments = notebookPath.split("/").filter(Boolean);
    if (segments.length !== 1 || segments[0] === "." || segments[0] === "..") {
      throw configError(
        `${INGEST_DESTINATIONS_ENV}[${index}].notebookPath must be a single vault notebook directory name.`
      );
    }

    const key = id.toLowerCase();
    if (seen.has(key)) {
      throw configError(`${INGEST_DESTINATIONS_ENV} contains duplicate id "${id}".`);
    }
    seen.add(key);

    return { id, label, notebookPath: segments[0] };
  });
}

function getIngestDestinationsSettingsPath(stateDir: string) {
  return path.join(path.resolve(stateDir), INGEST_DESTINATIONS_SETTINGS_FILENAME);
}

function readIngestDestinationsSettingsFile(stateDir: string): IngestDestinationsSettings | null {
  const settingsPath = getIngestDestinationsSettingsPath(stateDir);
  try {
    const raw = fs.readFileSync(settingsPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<IngestDestinationsSettings>;
    if (!Array.isArray(parsed.destinations)) {
      return { destinations: [], defaultId: null };
    }
    return {
      destinations: parsed.destinations,
      defaultId: typeof parsed.defaultId === "string" ? parsed.defaultId : null,
    };
  } catch {
    return null;
  }
}

function writeIngestDestinationsSettingsFile(stateDir: string, settings: IngestDestinationsSettings) {
  const settingsPath = getIngestDestinationsSettingsPath(stateDir);
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf8");
}

/**
 * Build the settings-store shape from the legacy env vars. Returns `null` when
 * neither env var configures anything, so the caller can distinguish "seed
 * available" from "nothing to seed".
 */
function seedIngestDestinationsFromEnv(): IngestDestinationsSettings | null {
  const destinations = parseIngestDestinations(process.env[INGEST_DESTINATIONS_ENV]);
  if (destinations.length === 0) {
    return null;
  }

  const configuredDefault = process.env[INGEST_DEFAULT_DESTINATION_ENV]?.trim();
  if (configuredDefault) {
    const match = destinations.find(
      (entry) => entry.id.toLowerCase() === configuredDefault.toLowerCase()
    );
    if (!match) {
      throw configError(
        `${INGEST_DEFAULT_DESTINATION_ENV}="${configuredDefault}" does not match any configured ingest destination id.`
      );
    }
    return { destinations, defaultId: match.id };
  }

  // A single-entry allowlist is unambiguous, so it is its own default.
  return { destinations, defaultId: destinations.length === 1 ? destinations[0].id : null };
}

/**
 * Load the persisted settings-store allowlist, seeding it once from the SN-234
 * env vars the first time no settings file exists yet. After that first read the
 * settings file is the sole source of truth — later env var edits are ignored,
 * so an in-app edit can never be silently reverted by a stale `.env.local` on
 * the next request. Never throws: an unconfigured deployment reads back as an
 * empty destination list so the settings UI can render its empty state.
 */
export function loadIngestDestinationsSettings(
  stateDir: string = getAppStateDir()
): IngestDestinationsSettings {
  const existing = readIngestDestinationsSettingsFile(stateDir);
  if (existing) {
    return existing;
  }

  const seeded = seedIngestDestinationsFromEnv();
  if (seeded) {
    writeIngestDestinationsSettingsFile(stateDir, seeded);
    return seeded;
  }

  return { destinations: [], defaultId: null };
}

export interface IngestDestinationsSaveInput {
  destinations: IngestDestination[];
  defaultId: string | null;
}

/**
 * Validate a full replacement of the allowlist before it is persisted. The
 * settings UI always saves the whole ordered list (add/edit/remove/reorder all
 * collapse to this), so validation only ever needs to check the proposed final
 * state, not a diff against the previous one.
 */
export function validateIngestDestinationsSettings(
  input: IngestDestinationsSaveInput,
  knownNotebookPaths: ReadonlySet<string>
): { ok: true; settings: IngestDestinationsSettings } | { ok: false; error: string } {
  if (!Array.isArray(input.destinations)) {
    return { ok: false, error: "destinations must be an array." };
  }

  const seen = new Set<string>();
  const normalized: IngestDestination[] = [];

  for (let index = 0; index < input.destinations.length; index += 1) {
    const raw = input.destinations[index] as Partial<IngestDestination> | null;
    const label = `Destination ${index + 1}`;
    if (!raw || typeof raw !== "object") {
      return { ok: false, error: `${label} must be an object.` };
    }

    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    if (!id) {
      return { ok: false, error: `${label} is missing an id.` };
    }
    const key = id.toLowerCase();
    if (seen.has(key)) {
      return { ok: false, error: `Duplicate destination id "${id}".` };
    }
    seen.add(key);

    const entryLabel = typeof raw.label === "string" ? raw.label.trim() : "";
    if (!entryLabel) {
      return { ok: false, error: `Destination "${id}" is missing a label.` };
    }

    const notebookPathRaw = typeof raw.notebookPath === "string" ? raw.notebookPath.trim() : "";
    if (!notebookPathRaw) {
      return { ok: false, error: `Destination "${id}" is missing a notebook.` };
    }
    const notebookPath = normalizeNotebookPath(notebookPathRaw);
    if (!knownNotebookPaths.has(comparableNotebookPath(notebookPath))) {
      return { ok: false, error: `Destination "${id}" references a notebook that does not exist.` };
    }

    normalized.push({ id, label: entryLabel, notebookPath });
  }

  let defaultId: string | null = null;
  if (input.defaultId) {
    const match = normalized.find((entry) => entry.id.toLowerCase() === input.defaultId!.toLowerCase());
    if (!match) {
      return { ok: false, error: `Default destination "${input.defaultId}" is not in the list.` };
    }
    defaultId = match.id;
  }

  return { ok: true, settings: { destinations: normalized, defaultId } };
}

/** Validate and persist a full replacement of the settings-store allowlist. */
export function saveIngestDestinationsSettings(
  stateDir: string,
  input: IngestDestinationsSaveInput,
  knownNotebookPaths: ReadonlySet<string>
): IngestDestinationsSettings {
  const result = validateIngestDestinationsSettings(input, knownNotebookPaths);
  if (!result.ok) {
    throw new VaultError("INVALID_INGEST_DESTINATIONS", result.error, 400);
  }
  writeIngestDestinationsSettingsFile(stateDir, result.settings);
  return result.settings;
}

/**
 * Load the configured allowlist. Throws when nothing is configured so an
 * unconfigured deployment fails closed instead of falling back to the global
 * Inbox, which resolves to the first notebook alphabetically — registered
 * portables included. That fallback is the SN-234 surprise this exists to remove.
 */
export function loadIngestDestinationCatalog(stateDir: string = getAppStateDir()): IngestDestinationCatalog {
  const settings = loadIngestDestinationsSettings(stateDir);
  if (settings.destinations.length === 0) {
    throw configError(
      `No ingest destinations are configured. Add one in Settings → Ingest, or set ${INGEST_DESTINATIONS_ENV} to seed one on first read.`
    );
  }

  return { destinations: settings.destinations, defaultId: settings.defaultId ?? undefined };
}

export function toIngestDestinationCatalogResponse(catalog: IngestDestinationCatalog) {
  const entries: IngestDestinationCatalogEntry[] = catalog.destinations.map((entry) => ({
    id: entry.id,
    label: entry.label,
    isDefault: entry.id === catalog.defaultId,
  }));
  return { destinations: entries, defaultId: catalog.defaultId ?? null };
}

function notAllowed(message: string) {
  return new VaultError("DESTINATION_NOT_ALLOWED", message, 403);
}

function findByNotebookSegment(catalog: IngestDestinationCatalog, value: string) {
  const comparable = comparableNotebookPath(value).split("/").filter(Boolean)[0] ?? "";
  return catalog.destinations.find(
    (item) => comparableNotebookPath(item.notebookPath) === comparable
  );
}

/**
 * Resolve an externally requested destination against the allowlist.
 *
 * Never falls back to the global Inbox: an unlisted destination is rejected and
 * an omitted destination requires a configured default.
 */
export function resolveAllowlistedDestination(
  requested: RequestedIngestDestination | undefined,
  catalog: IngestDestinationCatalog = loadIngestDestinationCatalog()
): ResolvedIngestDestination {
  const requestedId = requested?.id?.trim();
  const requestedNotebook = requested?.notebookPath?.trim();
  const requestedSection = requested?.sectionPath?.trim();

  let entry: IngestDestination | undefined;

  if (requestedId) {
    entry = catalog.destinations.find((item) => item.id.toLowerCase() === requestedId.toLowerCase());
    if (!entry) {
      throw notAllowed(`Ingest destination "${requestedId}" is not in the configured allowlist.`);
    }
  } else if (requestedNotebook) {
    entry = findByNotebookSegment(catalog, requestedNotebook);
    if (!entry || comparableNotebookPath(requestedNotebook) !== comparableNotebookPath(entry.notebookPath)) {
      throw notAllowed("The requested ingest destination is not in the configured allowlist.");
    }
  } else if (requestedSection) {
    // A section with no notebook: the notebook is its first path segment.
    entry = findByNotebookSegment(catalog, requestedSection);
    if (!entry) {
      throw notAllowed("The requested ingest destination is not in the configured allowlist.");
    }
  } else {
    if (!catalog.defaultId) {
      throw new VaultError(
        "DESTINATION_REQUIRED",
        `A "destination" is required: no default ingest destination is configured (set ${INGEST_DEFAULT_DESTINATION_ENV}).`,
        400
      );
    }
    entry = catalog.destinations.find((item) => item.id === catalog.defaultId)!;
  }

  if (!requestedSection) {
    return { entry };
  }

  // A section is honoured only when it lives inside the allowlisted notebook, so
  // it cannot be used to escape the allowlist.
  const normalizedSection = normalizeNotebookPath(requestedSection);
  if (normalizedSection.split("/").some((segment) => segment === "." || segment === "..")) {
    throw notAllowed("Path traversal is not allowed in an ingest destination.");
  }
  const comparableSection = normalizedSection.toLowerCase();
  const comparableNotebook = comparableNotebookPath(entry.notebookPath);
  if (
    comparableSection !== comparableNotebook &&
    !comparableSection.startsWith(`${comparableNotebook}/`)
  ) {
    throw notAllowed(
      `Section "${requestedSection}" is outside the allowlisted notebook for destination "${entry.id}".`
    );
  }

  return { entry, sectionPath: normalizedSection };
}
