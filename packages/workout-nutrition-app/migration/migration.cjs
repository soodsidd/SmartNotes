"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { isDeepStrictEqual } = require("node:util");

const APP_SUFFIXES = [".app.json", ".app-data.entries.json", ".app-data.config.json"];

function normalizePagePath(value) {
  const normalized = String(value || "").replaceAll("\\", "/").replace(/^\/+/, "");
  if (!normalized.endsWith(".html") || normalized.split("/").some((part) => part === ".." || part === ".")) {
    throw new Error("page must be a safe vault-relative .html path");
  }
  return normalized;
}

function resolveInside(root, relative) {
  const absoluteRoot = path.resolve(root);
  const absolute = path.resolve(absoluteRoot, ...relative.split("/"));
  const fromRoot = path.relative(absoluteRoot, absolute);
  if (fromRoot.startsWith("..") || path.isAbsolute(fromRoot)) throw new Error("path escapes the vault root");
  return absolute;
}

async function exists(target) {
  return fs.stat(target).catch(() => null);
}

async function walkFiles(root, relativeRoot) {
  const absolute = resolveInside(root, relativeRoot);
  const stat = await exists(absolute);
  if (!stat) return [];
  if (stat.isFile()) return [relativeRoot.replaceAll("\\", "/")];
  const output = [];
  for (const entry of await fs.readdir(absolute, { withFileTypes: true })) {
    const child = path.posix.join(relativeRoot, entry.name);
    if (entry.isDirectory()) output.push(...await walkFiles(root, child));
    else if (entry.isFile()) output.push(child);
  }
  return output.sort();
}

async function discoverArtifacts(vaultRoot, pagePath) {
  const page = normalizePagePath(pagePath);
  const section = path.posix.dirname(page);
  const fileName = path.posix.basename(page);
  const stem = fileName.slice(0, -".html".length);
  const sectionAbsolute = resolveInside(vaultRoot, section);
  const entries = await fs.readdir(sectionAbsolute, { withFileTypes: true });
  const roots = [];
  for (const entry of entries) {
    const isPage = entry.name === fileName;
    const isSiblingArtifact = entry.name.startsWith(`${stem}.`) && !APP_SUFFIXES.some((suffix) => entry.name === `${stem}${suffix}`) && !entry.name.includes(".sn183-");
    if (isPage || isSiblingArtifact) roots.push(path.posix.join(section, entry.name));
  }
  const versions = path.posix.join(section, ".versions", stem);
  if (await exists(resolveInside(vaultRoot, versions))) roots.push(versions);
  const files = [];
  for (const root of roots.sort()) files.push(...await walkFiles(vaultRoot, root));
  if (!files.includes(page)) throw new Error(`page artifact is missing: ${page}`);
  return [...new Set(files)].sort();
}

async function sha256File(file) {
  const bytes = await fs.readFile(file);
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

async function manifestEntries(vaultRoot, files) {
  return Promise.all(files.map(async (relativePath) => {
    const absolute = resolveInside(vaultRoot, relativePath);
    const stat = await fs.stat(absolute);
    return { path: relativePath, bytes: stat.size, sha256: await sha256File(absolute) };
  }));
}

function assertBackupOutsideVault(vaultRoot, backupDir) {
  const vault = path.resolve(vaultRoot);
  const backup = path.resolve(backupDir);
  const relative = path.relative(vault, backup);
  if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
    throw new Error("backup directory must be outside the source vault");
  }
}

async function copyArtifactFiles(sourceRoot, destinationRoot, files) {
  for (const relativePath of files) {
    const source = resolveInside(sourceRoot, relativePath);
    const destination = resolveInside(destinationRoot, relativePath);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(source, destination);
  }
}

async function createBackup({ vaultRoot, pagePath, backupDir }) {
  assertBackupOutsideVault(vaultRoot, backupDir);
  const backup = path.resolve(backupDir);
  if (await exists(backup)) throw new Error("backup destination already exists; choose a new path");
  const files = await discoverArtifacts(vaultRoot, pagePath);
  const artifacts = await manifestEntries(vaultRoot, files);
  const logPath = normalizePagePath(pagePath).replace(/\.html$/i, ".log.json");
  const log = JSON.parse(await fs.readFile(resolveInside(vaultRoot, logPath), "utf8"));
  const manifest = {
    version: 1,
    backupId: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    pagePath: normalizePagePath(pagePath),
    sourceRowCount: Array.isArray(log.rows) ? log.rows.length : 0,
    artifacts,
    restoreCommand: `node packages/workout-nutrition-app/migration/cli.mjs restore --vault-copy <copied-vault> --backup ${JSON.stringify(backup)}`,
  };
  await fs.mkdir(path.join(backup, "artifacts"), { recursive: true });
  await copyArtifactFiles(vaultRoot, path.join(backup, "artifacts"), files);
  await fs.writeFile(path.join(backup, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  await verifyBackup({ backupDir: backup });
  return manifest;
}

async function readManifest(backupDir) {
  return JSON.parse(await fs.readFile(path.join(path.resolve(backupDir), "manifest.json"), "utf8"));
}

async function verifyBackup({ backupDir }) {
  const backup = path.resolve(backupDir);
  const manifest = await readManifest(backup);
  const actual = await manifestEntries(path.join(backup, "artifacts"), manifest.artifacts.map((entry) => entry.path));
  if (!isDeepStrictEqual(actual, manifest.artifacts)) throw new Error("backup checksum verification failed");
  return { ok: true, artifactCount: actual.length, rowCount: manifest.sourceRowCount, backupId: manifest.backupId };
}

async function assertSourceUnchanged(vaultRoot, manifest) {
  const files = await discoverArtifacts(vaultRoot, manifest.pagePath);
  const actual = await manifestEntries(vaultRoot, files);
  if (!isDeepStrictEqual(actual, manifest.artifacts)) {
    throw new Error("source artifacts changed after backup/rehearsal; create and confirm a new backup before cutover");
  }
}

function appPageSource(legacyPage, appSource) {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(legacyPage);
  let metadata = frontmatter ? frontmatter[1] : "";
  if (/^note_type\s*:/m.test(metadata)) metadata = metadata.replace(/^note_type\s*:.*$/m, "note_type: app");
  else metadata = `${metadata}${metadata ? "\n" : ""}note_type: app`;
  return `---\n${metadata}\n---\n${appSource.trim()}\n`;
}

async function runtimeSupportsApps(runtimeUrl) {
  const base = String(runtimeUrl || "").replace(/\/$/, "");
  if (!base) throw new Error("--runtime-url is required for a live cutover");
  const response = await fetch(`${base}/api/app/capabilities`, { redirect: "manual" });
  if (!response.ok) throw new Error("target runtime does not expose the versioned App capability; deploy the App runtime before cutover");
  let capability;
  try {
    capability = await response.json();
  } catch {
    throw new Error("target runtime returned an invalid App capability response");
  }
  if (capability?.capability !== "smart-notes.app-pages" || capability?.version !== 1 || capability?.manifestVersion !== 1) {
    throw new Error("target runtime App capability is incompatible with this migration");
  }
  return true;
}

function equalityReport(before, after, expectedCount) {
  const beforeRows = Array.isArray(before.rows) ? before.rows : [];
  const afterRows = Array.isArray(after.rows) ? after.rows : [];
  const beforeIds = beforeRows.map((row) => row.id);
  const afterIds = afterRows.map((row) => row.id);
  const beforeTimestamps = beforeRows.map((row) => ({ createdAt: row.createdAt, updatedAt: row.updatedAt || null }));
  const afterTimestamps = afterRows.map((row) => ({ createdAt: row.createdAt, updatedAt: row.updatedAt || null }));
  const expected = Number(expectedCount);
  return {
    beforeCount: beforeRows.length,
    afterCount: afterRows.length,
    expectedCount: Number.isInteger(expected) ? expected : null,
    countMatches: beforeRows.length === afterRows.length,
    schemaEqual: isDeepStrictEqual(before.schema, after.schema),
    idsEqual: isDeepStrictEqual(beforeIds, afterIds),
    timestampsEqual: isDeepStrictEqual(beforeTimestamps, afterTimestamps),
    nestedValuesEqual: isDeepStrictEqual(beforeRows.map((row) => row.values), afterRows.map((row) => row.values)),
    explicitlyTransformedRows: 0,
    documentEqual: isDeepStrictEqual(before, after),
    warnings: Number.isInteger(expected) && expected !== beforeRows.length
      ? [`Expected baseline ${expected}; source currently contains ${beforeRows.length}. All current rows were preserved.`]
      : [],
  };
}

async function stageFile(target, contents, transactionId) {
  const temporary = `${target}.sn183-${transactionId}.tmp`;
  await fs.writeFile(temporary, contents, { encoding: "utf8", flag: "wx" });
  return temporary;
}

async function migrate({ vaultRoot, pagePath, backupDir, appSource, expectedCount = 13, rehearsal = false, ownerConfirmation, runtimeUrl, _testHooks }) {
  const page = normalizePagePath(pagePath);
  const manifest = await readManifest(backupDir);
  if (manifest.pagePath !== page) throw new Error("backup page path does not match migration target");
  if (typeof appSource !== "string" || !appSource.trim()) throw new Error("the maintained App source is required; migration cannot use a placeholder");
  await verifyBackup({ backupDir });
  await assertSourceUnchanged(vaultRoot, manifest);
  if (!rehearsal) {
    if (ownerConfirmation !== manifest.backupId) throw new Error("owner confirmation must exactly match the verified backup id");
    await runtimeSupportsApps(runtimeUrl);
  }
  const pageAbsolute = resolveInside(vaultRoot, page);
  const stemAbsolute = pageAbsolute.replace(/\.html$/i, "");
  const logAbsolute = `${stemAbsolute}.log.json`;
  const formAbsolute = `${stemAbsolute}.form.json`;
  const legacyPage = await fs.readFile(pageAbsolute, "utf8");
  const log = JSON.parse(await fs.readFile(logAbsolute, "utf8"));
  const formDefinition = JSON.parse(await fs.readFile(formAbsolute, "utf8"));
  if (!log || log.version !== 1 || !log.schema || !Array.isArray(log.rows)) throw new Error("legacy log document is invalid");
  const outputs = {
    page: appPageSource(legacyPage, appSource),
    manifest: `${JSON.stringify({ version: 1, enabled: true, tables: [
      { id: "entries", name: "Workout and nutrition entries", kind: "app", schema: log.schema },
      { id: "config", name: "Workout app configuration", kind: "app", schema: { fields: [
        { id: "form_definition", name: "Legacy form definition", type: "text", required: true },
        { id: "migration", name: "Migration metadata", type: "text", required: true },
      ] } },
      { id: "drafts", name: "In-progress entry drafts", kind: "app", schema: { fields: [
        { id: "kind", name: "Draft kind", type: "text", required: true },
        { id: "view", name: "In-progress form state", type: "text", required: true },
        { id: "savedAt", name: "Draft saved at", type: "text", required: true },
      ] } },
    ] }, null, 2)}\n`,
    entries: `${JSON.stringify(log, null, 2)}\n`,
    config: `${JSON.stringify({ version: 1, schema: { fields: [
      { id: "form_definition", name: "Legacy form definition", type: "text", required: true },
      { id: "migration", name: "Migration metadata", type: "text", required: true },
    ] }, rows: [{ id: "r_sn183config", createdAt: new Date().toISOString(), values: {
      form_definition: formDefinition,
      migration: { version: 1, backupId: manifest.backupId, sourceRowCount: log.rows.length },
    } }] }, null, 2)}\n`,
  };
  const targets = {
    page: pageAbsolute,
    manifest: `${stemAbsolute}.app.json`,
    entries: `${stemAbsolute}.app-data.entries.json`,
    config: `${stemAbsolute}.app-data.config.json`,
  };
  for (const key of ["manifest", "entries", "config"]) {
    if (await exists(targets[key])) throw new Error(`migration output already exists: ${path.basename(targets[key])}`);
  }
  const transactionId = crypto.randomUUID();
  const staged = {};
  try {
    for (const key of Object.keys(targets)) staged[key] = await stageFile(targets[key], outputs[key], transactionId);
    const rollbackPage = `${pageAbsolute}.sn183-${transactionId}.rollback`;
    await fs.rename(pageAbsolute, rollbackPage);
    try {
      let promotedCount = 0;
      for (const key of ["page", "manifest", "entries", "config"]) {
        await fs.rename(staged[key], targets[key]);
        promotedCount += 1;
        if (typeof _testHooks?.afterPromotion === "function") {
          await _testHooks.afterPromotion({ key, promotedCount });
        }
      }
      for (const suffix of [".log.json", ".form.json"]) await fs.rm(`${stemAbsolute}${suffix}`, { force: true });
      await fs.rm(rollbackPage, { force: true });
    } catch (error) {
      await restoreBackup({ vaultRoot, backupDir, removeAppOutputs: true });
      await fs.rm(rollbackPage, { force: true }).catch(() => undefined);
      throw error;
    }
  } finally {
    for (const temporary of Object.values(staged)) await fs.rm(temporary, { force: true }).catch(() => undefined);
  }
  const migrated = JSON.parse(await fs.readFile(targets.entries, "utf8"));
  return { backupId: manifest.backupId, pagePath: page, ...equalityReport(log, migrated, expectedCount) };
}

async function restoreBackup({ vaultRoot, backupDir, removeAppOutputs = true }) {
  const manifest = await readManifest(backupDir);
  await verifyBackup({ backupDir });
  const page = normalizePagePath(manifest.pagePath);
  const stemAbsolute = resolveInside(vaultRoot, page).replace(/\.html$/i, "");
  if (removeAppOutputs) {
    for (const suffix of APP_SUFFIXES) await fs.rm(`${stemAbsolute}${suffix}`, { force: true });
  }
  await copyArtifactFiles(path.join(path.resolve(backupDir), "artifacts"), vaultRoot, manifest.artifacts.map((entry) => entry.path));
  const actual = await manifestEntries(vaultRoot, manifest.artifacts.map((entry) => entry.path));
  if (!isDeepStrictEqual(actual, manifest.artifacts)) throw new Error("restore verification failed");
  return { ok: true, artifactCount: actual.length, rowCount: manifest.sourceRowCount, pagePath: page };
}

async function rehearse(options) {
  const manifest = await readManifest(options.backupDir);
  await verifyBackup({ backupDir: options.backupDir });
  const targetPage = resolveInside(options.vaultRoot, manifest.pagePath);
  if (await exists(targetPage)) throw new Error("rehearsal vault copy must be empty at the target page; restore the verified backup into it first");
  await restoreBackup({ vaultRoot: options.vaultRoot, backupDir: options.backupDir });
  await assertSourceUnchanged(options.vaultRoot, manifest);
  const first = await migrate({ ...options, rehearsal: true });
  const restored = await restoreBackup({ vaultRoot: options.vaultRoot, backupDir: options.backupDir });
  await assertSourceUnchanged(options.vaultRoot, manifest);
  const final = await migrate({ ...options, rehearsal: true });
  return { ...final, firstMigrationVerified: first.countMatches && first.schemaEqual && first.idsEqual && first.timestampsEqual && first.nestedValuesEqual && first.documentEqual, restoreVerified: restored.ok };
}

module.exports = {
  normalizePagePath, discoverArtifacts, createBackup, verifyBackup, restoreBackup, migrate, rehearse,
  runtimeSupportsApps,
  equalityReport, derive: { resolveInside, manifestEntries, assertSourceUnchanged, appPageSource },
};
