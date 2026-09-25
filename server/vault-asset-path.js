const fs = require("fs");
const os = require("os");
const path = require("path");

const PORTABLE_PREFIX = "+";
const REGISTRY_FILENAME = "notebook-registry.json";

function defaultAppStateDir() {
  return path.join(os.homedir(), ".cli-chat", "dev-workspace", "smart-notes");
}

function getAppStateDirs() {
  if (process.env.SMART_NOTES_STATE_DIR) {
    return [path.resolve(process.env.SMART_NOTES_STATE_DIR)];
  }

  const dirs = [];
  if (process.env.CLI_CHAT_RUNTIME_DIR) {
    dirs.push(path.resolve(process.env.CLI_CHAT_RUNTIME_DIR));
  }

  dirs.push(defaultAppStateDir());
  return [...new Set(dirs)];
}

function loadPortableRoots() {
  const roots = [];
  const seenIds = new Set();

  for (const appStateDir of getAppStateDirs()) {
    const registryPath = path.join(appStateDir, REGISTRY_FILENAME);
    if (!fs.existsSync(registryPath)) {
      continue;
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(registryPath, "utf8"));
      const notebooks = Array.isArray(parsed?.notebooks) ? parsed.notebooks : [];
      for (const entry of notebooks) {
        const id = String(entry?.id ?? "").trim();
        const rootPath = path.resolve(String(entry?.rootPath ?? "").trim());
        if (!id || !rootPath || seenIds.has(id)) {
          continue;
        }
        seenIds.add(id);
        roots.push({ id, rootPath });
      }
    } catch {
      // Ignore malformed registry files; later state dirs may still be usable.
    }
  }

  return roots;
}

function resolvePortableRoot(relativePath) {
  const normalized = String(relativePath ?? "").replaceAll("\\", "/").replace(/^\/+/, "");
  const firstSegment = normalized.split("/")[0] ?? "";
  if (!firstSegment.startsWith(PORTABLE_PREFIX)) {
    return null;
  }

  const portableId = firstSegment.slice(PORTABLE_PREFIX.length);
  return loadPortableRoots().find((notebook) => notebook.id === portableId) ?? null;
}

function resolveVaultAssetAbsolutePath(vaultRoot, relativePath) {
  const normalized = String(relativePath ?? "").replaceAll("\\", "/").replace(/^\/+/, "");
  const portableEntry = resolvePortableRoot(normalized);

  if (!portableEntry) {
    return path.resolve(vaultRoot, normalized);
  }

  const portablePrefix = `${PORTABLE_PREFIX}${portableEntry.id}`;
  const remainder =
    normalized === portablePrefix ? "" : normalized.slice(portablePrefix.length + 1);

  return remainder
    ? path.resolve(portableEntry.rootPath, ...remainder.split("/"))
    : portableEntry.rootPath;
}

module.exports = {
  resolveVaultAssetAbsolutePath,
};
