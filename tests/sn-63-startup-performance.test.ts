import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  invalidateVaultTreeCacheForTesting,
  readVaultTree,
} from "@/server/vault/pages";

describe("SN-63 startup performance wiring", () => {
  const pagesSrc = fs.readFileSync(path.join(process.cwd(), "src/server/vault/pages.ts"), "utf8");
  const shellSrc = fs.readFileSync(
    path.join(process.cwd(), "src/components/notebook-shell-reliable.tsx"),
    "utf8"
  );
  const swTemplate = fs.readFileSync(
    path.join(process.cwd(), "scripts/service-worker.template.js"),
    "utf8"
  );
  const serverSrc = fs.readFileSync(path.join(process.cwd(), "server.js"), "utf8");

  it("parallelizes page reads within each section", () => {
    expect(pagesSrc).toContain("async function readSectionPages");
    // Parallel path maps all page entries (files + orphan design-link stubs).
    expect(pagesSrc).toContain("await Promise.all(");
    expect(pagesSrc).toContain("allPageEntries.map(");
    expect(pagesSrc).toContain("sequential");
  });

  it("renders the app shell before vault hydration in normal mode", () => {
    const pageSrc = fs.readFileSync(path.join(process.cwd(), "src/app/page.tsx"), "utf8");
    expect(shellSrc).toContain('data-testid="app-shell"');
    expect(shellSrc).toContain('data-testid="vault-loading"');
    expect(shellSrc).toContain("startupBaselineMode && isLoadingTree");
    expect(shellSrc).not.toMatch(/if \(isLoadingTree\) \{\s*return \(/);
    expect(pageSrc).toMatch(/readVaultTree\(\s*(?:\{[^}]*\})?\s*\)/);
    expect(pageSrc).toContain("initialVault={initialVault}");
  });

  it("caches navigations for repeat PWA launches", () => {
    expect(swTemplate).toContain("return cachedResponse || networkResponse");
    expect(swTemplate).toContain("event.respondWith(staleWhileRevalidate(request, STATIC_CACHE))");
  });

  it("preserves the Next development cache across ordinary preview restarts", () => {
    expect(serverSrc).toContain('process.env.SMART_NOTES_CLEAR_DEV_CACHE === "1"');
    expect(serverSrc).toContain("if (cacheLock.acquired && clearDevCache)");
    expect(serverSrc).toContain("cache for fast preview restart");
  });

  it("keeps development and E2E compile output out of production .next", () => {
    expect(serverSrc).toContain('process.env.SMART_NOTES_NEXT_DIST_DIR = ".next-dev"');
    expect(serverSrc).toContain('SMART_NOTES_SKIP_SW_GENERATE !== "1"');
    const playwrightSrc = fs.readFileSync(
      path.join(process.cwd(), "playwright.config.ts"),
      "utf8"
    );
    expect(playwrightSrc).toContain("SMART_NOTES_NEXT_DIST_DIR: '.next-e2e'");
    expect(playwrightSrc).toContain("SMART_NOTES_SKIP_SW_GENERATE: '1'");
    expect(playwrightSrc).toContain("globalSetup: './e2e/global-setup.ts'");
    expect(playwrightSrc).toContain("...process.env");
    expect(playwrightSrc).toContain("**/sn-135-*.spec.ts");
    expect(playwrightSrc).toContain("**/sn-136-*.spec.ts");
    expect(playwrightSrc).toContain("**/sn-151-*.spec.ts");
    const globalSetupSrc = fs.readFileSync(
      path.join(process.cwd(), "e2e/global-setup.ts"),
      "utf8"
    );
    expect(globalSetupSrc).toContain("sn135-catalogue-");
    expect(globalSetupSrc).toContain(".e2e-portable-vault");
    expect(globalSetupSrc).toContain(".e2e-vault");
    expect(globalSetupSrc).toContain(".e2e-state");
    expect(globalSetupSrc).toContain("Personal Notebook");
    expect(globalSetupSrc).toContain("Rich Vault Notebook");
    expect(globalSetupSrc).toContain("KEEP_VAULT_NOTEBOOKS");
    expect(globalSetupSrc).toContain("Welcome to Smart Notes.html");
    expect(globalSetupSrc).toContain("AssetTarget.html");
    expect(globalSetupSrc).toContain("strength-training-reference-plan.html");
    // Must not target the production vault directory.
    expect(globalSetupSrc).not.toMatch(/["']vault["']/);
    expect(globalSetupSrc).not.toContain("path.join(ROOT, \"vault\")");
  });
});

describe("readVaultTree parallel reads", () => {
  const previousVault = process.env.SMART_NOTES_VAULT;

  afterEach(() => {
    if (previousVault) {
      process.env.SMART_NOTES_VAULT = previousVault;
    } else {
      delete process.env.SMART_NOTES_VAULT;
    }
    invalidateVaultTreeCacheForTesting();
  });

  it("returns the same tree shape with sequential and parallel reads", async () => {
    const vaultRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "sn63-vault-"));
    process.env.SMART_NOTES_VAULT = vaultRoot;

    const sectionDir = path.join(vaultRoot, "Notebook", "Section");
    await fs.promises.mkdir(sectionDir, { recursive: true });
    await Promise.all(
      Array.from({ length: 8 }, async (_, index) => {
        await fs.promises.writeFile(
          path.join(sectionDir, `page-${index}.html`),
          `---
title: Page ${index}
---
<p>Body ${index}</p>
`,
          "utf8"
        );
      })
    );

    invalidateVaultTreeCacheForTesting();
    const parallel = await readVaultTree({ skipCache: true, sequential: false });
    invalidateVaultTreeCacheForTesting();
    const sequential = await readVaultTree({ skipCache: true, sequential: true });

    expect(parallel.tree).toEqual(sequential.tree);

    await fs.promises.rm(vaultRoot, { recursive: true, force: true });
  });
});
