const fs = require('fs');
const path = require('path');

const DEFAULT_CATALOG_URL = 'http://127.0.0.1:8787/api/provider-catalog';

function normalizeCatalog(payload) {
  if (!payload || payload.schemaVersion !== 1 || !Array.isArray(payload.providers)
    || !payload.modelsByProvider || typeof payload.modelsByProvider !== 'object') return null;

  const providers = [];
  for (const provider of payload.providers) {
    if (!provider || typeof provider.id !== 'string' || typeof provider.label !== 'string'
      || !Array.isArray(provider.models)) return null;
    const enabledIds = payload.modelsByProvider[provider.id];
    if (!Array.isArray(enabledIds) || !enabledIds.every(id => typeof id === 'string')) return null;
    const enabled = new Set(enabledIds);
    const modelsById = new Map(provider.models.map(model => [model?.id, model]));
    const models = [];
    for (const id of enabledIds) {
      const model = modelsById.get(id);
      if (!model || model.status !== 'enabled' || !enabled.has(id)) return null;
      models.push({ id, label: typeof model.label === 'string' ? model.label : id });
    }
    providers.push({ id: provider.id, label: provider.label, models });
  }
  return { schemaVersion: 1, providers };
}

function createProviderCatalog({ cachePath, url = DEFAULT_CATALOG_URL, fetchImpl = fetch, timeoutMs = 2500 }) {
  let current = null;
  try {
    current = normalizeCatalog(JSON.parse(fs.readFileSync(cachePath, 'utf8')));
  } catch { /* No last-known-good response yet. */ }

  let inFlight = null;
  async function refresh() {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
        if (!response.ok) return current;
        const payload = await response.json();
        const next = normalizeCatalog(payload);
        if (!next) return current;
        current = next;
        const tempPath = `${cachePath}.${process.pid}.tmp`;
        fs.mkdirSync(path.dirname(cachePath), { recursive: true });
        fs.writeFileSync(tempPath, JSON.stringify(payload));
        fs.renameSync(tempPath, cachePath);
      } catch { /* Keep the last valid catalog when the sidecar is unavailable. */ }
      return current;
    })();
    try { return await inFlight; } finally { inFlight = null; }
  }

  return { get: () => current, refresh };
}

module.exports = { createProviderCatalog, normalizeCatalog, DEFAULT_CATALOG_URL };
