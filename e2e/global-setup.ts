import fs from "node:fs";
import path from "node:path";

/**
 * Reset E2E isolation dirs before the default Playwright suite.
 * SN-135/136 seed a portable "Higher Ground" fixture under `.e2e-portable-vault`
 * and create many `sn135-catalogue-*` pages; SN-151 leaves a Learning/Deep Learning
 * notebook in `.e2e-vault`. Leaving those behind makes later desktop/mobile smoke
 * tests time out (huge tree, wrong active page, missing dialogs). Production
 * vault/ must never be touched here.
 */
const ROOT = path.resolve(__dirname, "..");
const E2E_VAULT = path.join(ROOT, ".e2e-vault");
const E2E_STATE = path.join(ROOT, ".e2e-state");
const E2E_PORTABLE = path.join(ROOT, ".e2e-portable-vault");
const KEEP_VAULT_NOTEBOOKS = new Set(["Personal Notebook", "Rich Vault Notebook"]);

const WELCOME_HTML = `---
title: Welcome to Smart Notes
created: 2026-05-25T18:12:00Z
updated: 2026-05-25T18:15:21Z
---
<p>OneNote-style research vault backed by HTML page files.</p>
`;

const ASSET_TARGET_HTML = `---
title: AssetTarget
created: 2026-05-25T18:12:00Z
updated: 2026-05-25T18:15:21Z
---
<p>Asset upload target for E2E.</p>
`;

const STRENGTH_TRAINING_HTML = `---
title: Strength Training Reference Plan
created: 2026-05-25T18:12:00Z
updated: 2026-05-25T18:15:21Z
---
<p>30-35 min lunch workouts, Mon/Wed/Fri.</p>
<p>Workouts A/B/C baseline for SN-11.</p>
`;

function rmIfExists(target: string) {
  if (fs.existsSync(target)) {
    fs.rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

function cleanPortableCataloguePollution() {
  const configDir = path.join(E2E_PORTABLE, "Config");
  if (!fs.existsSync(configDir)) return;
  for (const entry of fs.readdirSync(configDir, { withFileTypes: true })) {
    const name = entry.name;
    if (!/^sn135-catalogue-/i.test(name)) continue;
    rmIfExists(path.join(configDir, name));
  }
}

function ensureSeedPage(filePath: string, contents: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents, "utf8");
}

function resetE2eVaultNotebooks() {
  fs.mkdirSync(E2E_VAULT, { recursive: true });
  for (const entry of fs.readdirSync(E2E_VAULT, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (KEEP_VAULT_NOTEBOOKS.has(entry.name)) continue;
    rmIfExists(path.join(E2E_VAULT, entry.name));
  }

  // Quick Notes accumulates disposable pages from sn-9/13/38/40/53/123/….
  // Wipe everything and reseed durable pages so titles/paths stay stable.
  const quickNotes = path.join(E2E_VAULT, "Personal Notebook", "Quick Notes");
  fs.mkdirSync(quickNotes, { recursive: true });
  for (const entry of fs.readdirSync(quickNotes, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    rmIfExists(path.join(quickNotes, entry.name));
  }
  ensureSeedPage(path.join(quickNotes, "Welcome to Smart Notes.html"), WELCOME_HTML);
  ensureSeedPage(path.join(quickNotes, "AssetTarget.html"), ASSET_TARGET_HTML);
  ensureSeedPage(
    path.join(quickNotes, "strength-training-reference-plan.html"),
    STRENGTH_TRAINING_HTML
  );

  // Keep Rich Vault Notebook skeleton for markdown/HTML load specs.
  const richNotes = path.join(E2E_VAULT, "Rich Vault Notebook", "Notes Section");
  fs.mkdirSync(richNotes, { recursive: true });
}

function resetE2eUiState() {
  fs.mkdirSync(E2E_VAULT, { recursive: true });
  fs.writeFileSync(
    path.join(E2E_VAULT, ".smart-notes-ui-state.json"),
    `${JSON.stringify(
      {
        version: 1,
        expandedNotebooks: ["Personal Notebook", "Rich Vault Notebook"],
        expandedSections: ["Personal Notebook/Quick Notes", "Rich Vault Notebook/Notes Section"],
        closedNotebooks: [],
        expandedPages: [],
        companionPersist: false,
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

function resetE2eRegistry() {
  fs.mkdirSync(E2E_STATE, { recursive: true });
  // Empty until a dedicated PDF spec seeds the portable fixture. Keeps the
  // default smoke suite on Personal Notebook / Rich Vault only.
  fs.writeFileSync(
    path.join(E2E_STATE, "notebook-registry.json"),
    `${JSON.stringify({ version: 1, notebooks: [] }, null, 2)}\n`,
    "utf8"
  );
}

export default async function globalSetup() {
  cleanPortableCataloguePollution();
  resetE2eVaultNotebooks();
  resetE2eUiState();
  resetE2eRegistry();
}
