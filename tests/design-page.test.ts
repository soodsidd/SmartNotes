import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { executeVaultCommand } from "@/server/vault/agent-commands";
import { executeVaultTool, getVaultToolDefinition } from "@/server/vault/agent-tools";
import { invalidateVaultTreeCacheForTesting, readPage } from "@/server/vault/pages";
import { resetRenderTokensForTesting } from "@/server/vault/page-render-token";
import { resolveUiViewportWidth, UI_RENDER_VIEWPORTS } from "@/server/vault/page-render";

jest.mock("@/server/vault/page-render", () => ({
  ...jest.requireActual("@/server/vault/page-render"),
  renderUiToPng: jest.fn(async (options: { viewport?: unknown }) => ({
    relativePath: "Notebook/Section/art.assets/ui-render-desktop-latest.png",
    vaultUrl: "/vault/Notebook/Section/art.assets/ui-render-desktop-latest.png",
    absoluteVaultUrl:
      "http://127.0.0.1:3002/vault/Notebook/Section/art.assets/ui-render-desktop-latest.png",
    absoluteDiskPath: path.join(os.tmpdir(), "art.assets", "ui-render-desktop-latest.png"),
    width: 2560,
    height: 3000,
    bytes: 8192,
    warnings: [],
    _viewport: options.viewport,
  })),
}));

const { renderUiToPng } = jest.requireMock("@/server/vault/page-render") as {
  renderUiToPng: jest.Mock;
};

const SECTION = "Notebook/Section";
const TEXT_PATH = "Notebook/Section/seed.html";
const TEXT_CONTENT = `---
title: Seed
created: 2026-07-01T00:00:00Z
updated: 2026-07-01T00:00:00Z
---
<p>Plain text page.</p>
`;

async function withVaultFixture(run: () => Promise<void>) {
  const previousVault = process.env.SMART_NOTES_VAULT;
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "smart-notes-design-"));
  process.env.SMART_NOTES_VAULT = vaultRoot;
  invalidateVaultTreeCacheForTesting();
  resetRenderTokensForTesting();
  try {
    await fs.mkdir(path.join(vaultRoot, "Notebook", "Section"), { recursive: true });
    await fs.writeFile(path.join(vaultRoot, TEXT_PATH), TEXT_CONTENT, "utf8");
    await run();
  } finally {
    if (previousVault) process.env.SMART_NOTES_VAULT = previousVault;
    else delete process.env.SMART_NOTES_VAULT;
    await fs.rm(vaultRoot, { recursive: true, force: true });
    invalidateVaultTreeCacheForTesting();
    resetRenderTokensForTesting();
  }
}

describe("resolveUiViewportWidth (SN-167 viewport presets)", () => {
  it("defaults to the desktop preset", () => {
    expect(resolveUiViewportWidth(undefined)).toBe(UI_RENDER_VIEWPORTS.desktop);
    expect(UI_RENDER_VIEWPORTS.desktop).toBe(1280);
  });

  it("maps the mobile preset name to 390", () => {
    expect(resolveUiViewportWidth("mobile")).toBe(390);
    expect(UI_RENDER_VIEWPORTS.mobile).toBe(390);
  });

  it("passes through an explicit width and clamps out-of-range values", () => {
    expect(resolveUiViewportWidth(768)).toBe(768);
    expect(resolveUiViewportWidth(50)).toBe(240); // clamped low
    expect(resolveUiViewportWidth(99999)).toBe(4096); // clamped high
  });
});

describe("note_type=design mapping (SN-167)", () => {
  it("creates a design page with note_type frontmatter and a RAW (un-normalized) body", async () => {
    await withVaultFixture(async () => {
      const created = await executeVaultCommand({
        group: "page",
        action: "create",
        args: {
          sectionPath: SECTION,
          title: "Art",
          noteType: "design",
          // A $...$ sequence would be rewritten to a Tiptap math node on a text
          // page; on a design page it must survive verbatim.
          content: "<section class=\"hero\">Price: $9.99 each</section>",
        },
      });
      const createdPath = (created.data as { page: { path: string } }).page.path;
      const page = await readPage(createdPath);
      expect(page.metadata.note_type).toBe("design");
      expect(page.body).toContain("$9.99");
      expect(page.body).toContain('class="hero"');
      expect(page.body).not.toContain("data-type=\"math\"");
    });
  });

  it("rejects unsupported noteType values on page_create", async () => {
    await withVaultFixture(async () => {
      const result = await executeVaultTool("page_create", {
        sectionPath: SECTION,
        title: "Nope",
        noteType: "jupyter",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("INVALID_INPUT");
    });
  });
});

describe("ui_render vault tool (SN-167)", () => {
  beforeEach(() => renderUiToPng.mockClear());

  it("registers ui_render with a required path and resolves the ur alias", () => {
    const tool = getVaultToolDefinition("ui_render");
    expect(tool?.group).toBe("design");
    expect(tool?.action).toBe("render");
    expect(tool?.parameters.path.required).toBe(true);
    expect(getVaultToolDefinition("ur")?.name).toBe("ui_render");
  });

  it("dispatches a named viewport preset to renderUiToPng", async () => {
    await withVaultFixture(async () => {
      const created = await executeVaultCommand({
        group: "page",
        action: "create",
        args: { sectionPath: SECTION, title: "Art", noteType: "design" },
      });
      const createdPath = (created.data as { page: { path: string } }).page.path;
      const result = await executeVaultTool("ur", { path: createdPath, viewport: "mobile" });
      expect(result.ok).toBe(true);
      expect(renderUiToPng).toHaveBeenCalledWith(
        expect.objectContaining({ pagePath: createdPath, viewport: "mobile" })
      );
    });
  });

  it("resolves an explicit viewportWidth to a numeric width", async () => {
    await withVaultFixture(async () => {
      const created = await executeVaultCommand({
        group: "page",
        action: "create",
        args: { sectionPath: SECTION, title: "Art", noteType: "design" },
      });
      const createdPath = (created.data as { page: { path: string } }).page.path;
      await executeVaultCommand({
        group: "design",
        action: "render",
        args: { path: createdPath, viewportWidth: 768 },
      });
      expect(renderUiToPng).toHaveBeenCalledWith(
        expect.objectContaining({ pagePath: createdPath, viewport: 768 })
      );
    });
  });

  it("rejects ui_render on a non-design page", async () => {
    await withVaultFixture(async () => {
      const result = await executeVaultTool("ui_render", { path: TEXT_PATH });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("INVALID_INPUT");
      expect(renderUiToPng).not.toHaveBeenCalled();
    });
  });
});

describe("design-page mutator guards (SN-167 review hold)", () => {
  async function createDesignPage() {
    const created = await executeVaultCommand({
      group: "page",
      action: "create",
      args: {
        sectionPath: SECTION,
        title: "Art",
        noteType: "design",
        content: '<section class="hero">Price: $9.99</section>',
      },
    });
    return (created.data as { page: { path: string } }).page.path;
  }

  it("page_update_body skips math normalization on design pages", async () => {
    await withVaultFixture(async () => {
      const designPath = await createDesignPage();
      const raw = '<div class="card">Cost: $12.50 <style>.card{color:red}</style></div>';
      const result = await executeVaultTool("page_update_body", {
        path: designPath,
        body: raw,
      });
      expect(result.ok).toBe(true);
      const page = await readPage(designPath);
      expect(page.body).toContain("$12.50");
      expect(page.body).toContain("<style>");
      expect(page.body).not.toContain('data-type="math"');
    });
  });

  it("rejects page_append on design pages and points to page_write/page_edit", async () => {
    await withVaultFixture(async () => {
      const designPath = await createDesignPage();
      const before = await readPage(designPath);
      const result = await executeVaultTool("page_append", {
        path: designPath,
        text: "injected",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("INVALID_INPUT");
        expect(result.error).toMatch(/page_write|page_edit/);
      }
      const after = await readPage(designPath);
      expect(after.body).toBe(before.body);
    });
  });

  it("rejects page_prepend and page_replace_section on design pages", async () => {
    await withVaultFixture(async () => {
      const designPath = await createDesignPage();
      const prepend = await executeVaultTool("page_prepend", {
        path: designPath,
        text: "nope",
      });
      expect(prepend.ok).toBe(false);
      if (!prepend.ok) {
        expect(prepend.code).toBe("INVALID_INPUT");
        expect(prepend.error).toMatch(/page_write|page_edit/);
      }

      const replace = await executeVaultTool("page_replace_section", {
        path: designPath,
        heading: "Hero",
        content: "<p>nope</p>",
      });
      expect(replace.ok).toBe(false);
      if (!replace.ok) {
        expect(replace.code).toBe("INVALID_INPUT");
        expect(replace.error).toMatch(/page_write|page_edit/);
      }
    });
  });

  it("rejects page_render / rr on design pages and points to ui_render", async () => {
    await withVaultFixture(async () => {
      const designPath = await createDesignPage();
      const named = await executeVaultTool("page_render", { path: designPath });
      expect(named.ok).toBe(false);
      if (!named.ok) {
        expect(named.code).toBe("INVALID_INPUT");
        expect(named.error).toMatch(/ui_render/);
      }

      const alias = await executeVaultTool("rr", { path: designPath });
      expect(alias.ok).toBe(false);
      if (!alias.ok) {
        expect(alias.code).toBe("INVALID_INPUT");
        expect(alias.error).toMatch(/ui_render/);
      }
    });
  });
});
