import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Editor } from "@tiptap/core";
import { JSDOM } from "jsdom";
import {
  createEditorExtensions,
  insertUploadedEditorAsset,
} from "@/lib/rich-text-editor-config";
import {
  buildReloadDraftSnapshot,
  hasUnsavedLocalDraftChanges,
  rebaseDraftAfterSave,
} from "@/lib/page-reload";
import type { ApiPageDocument } from "@/lib/vault-contract";
import { uploadPageAsset } from "@/server/vault/assets";
import { createPage, readPage, savePage } from "@/server/vault/pages";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
});
const previousGlobals = new Map<string, PropertyDescriptor | undefined>();

beforeAll(() => {
  const globals = {
    window: dom.window,
    document: dom.window.document,
    Node: dom.window.Node,
    HTMLElement: dom.window.HTMLElement,
    ShadowRoot: dom.window.ShadowRoot,
    DOMParser: dom.window.DOMParser,
    MutationObserver: dom.window.MutationObserver,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
  };

  for (const [name, value] of Object.entries(globals)) {
    previousGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value,
    });
  }
});

afterAll(() => {
  for (const [name, descriptor] of previousGlobals) {
    if (descriptor) {
      Object.defineProperty(globalThis, name, descriptor);
    } else {
      delete (globalThis as Record<string, unknown>)[name];
    }
  }
  dom.window.close();
});

async function withVaultFixture(run: (vaultRoot: string) => Promise<void>) {
  const previousVault = process.env.SMART_NOTES_VAULT;
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "smart-notes-attachment-"));
  process.env.SMART_NOTES_VAULT = vaultRoot;

  try {
    await fs.mkdir(path.join(vaultRoot, "Notebook", "Section"), { recursive: true });
    await run(vaultRoot);
  } finally {
    if (previousVault) {
      process.env.SMART_NOTES_VAULT = previousVault;
    } else {
      delete process.env.SMART_NOTES_VAULT;
    }
    await fs.rm(vaultRoot, { recursive: true, force: true });
  }
}

describe("editor attachment persistence (SN-272)", () => {
  it("persists an uploaded PDF chip through save and reload", async () => {
    await withVaultFixture(async () => {
      const created = await createPage({
        sectionPath: "Notebook/Section",
        title: "Documents",
      });
      const asset = await uploadPageAsset(
        created.path,
        "receipt.pdf",
        Buffer.from("%PDF-1.7 fixture")
      );
      const element = document.createElement("div");
      document.body.appendChild(element);
      const editor = new Editor({
        element,
        extensions: createEditorExtensions(),
        content: created.body,
      });

      try {
        let publishedHtml = "";
        const html = insertUploadedEditorAsset(
          editor,
          asset,
          "receipt.pdf",
          (nextHtml) => {
            publishedHtml = nextHtml;
          }
        );
        expect(html).toContain('data-file-attachment=""');
        expect(html).toContain(asset.url);
        expect(publishedHtml).toBe(html);

        await savePage({
          path: created.path,
          title: created.title,
          body: publishedHtml,
        });
        const reloaded = await readPage(created.path);
        expect(reloaded.body).toContain('data-file-type="pdf"');
        expect(reloaded.body).toContain(asset.url);
        expect(reloaded.body.match(/data-file-attachment/g)).toHaveLength(1);
      } finally {
        editor.destroy();
        element.remove();
      }
    });
  });

  it("fails instead of reporting success when the editor rejects insertion", () => {
    const publishHtml = jest.fn();
    const editor = {
      chain: () => ({
        focus: () => ({
          insertFileAttachment: () => ({ run: () => false }),
        }),
      }),
      getHTML: () => "<p></p>",
    } as unknown as Editor;

    expect(() =>
      insertUploadedEditorAsset(
        editor,
        {
          url: "/vault/Notebook/Section/documents.assets/receipt.pdf",
          path: "Notebook/Section/documents.assets/receipt.pdf",
          fileName: "receipt.pdf",
          isImage: false,
        },
        "receipt.pdf",
        publishHtml
      )
    ).toThrow(/still available for recovery/i);
    expect(publishHtml).not.toHaveBeenCalled();
  });

  it("preserves a later attachment when an older save response returns", () => {
    const firstAttachment =
      '<p><span data-file-attachment="" data-href="/vault/page.assets/first.pdf">first.pdf</span></p>';
    const secondAttachment =
      '<p><span data-file-attachment="" data-href="/vault/page.assets/first.pdf">first.pdf</span>' +
      '<span data-file-attachment="" data-href="/vault/page.assets/second.pdf">second.pdf</span></p>';
    const base = {
      id: "page",
      path: "Notebook/Section/page",
      title: "Page",
      slug: "page",
      createdAt: "2026-09-26T00:00:00.000Z",
      updatedAt: "2026-09-26T00:00:00.000Z",
      preview: "",
      content: firstAttachment,
      body: firstAttachment,
      parentId: null,
      noteType: "text",
      metadata: {},
      notebookPath: "Notebook",
      notebookName: "Notebook",
      sectionPath: "Notebook/Section",
      sectionName: "Section",
    } satisfies ApiPageDocument;
    const latestDraft = {
      ...base,
      content: secondAttachment,
    };
    const olderSaveResponse = {
      ...base,
      updatedAt: "2026-09-26T00:00:01.000Z",
    };

    const rebased = rebaseDraftAfterSave(latestDraft, olderSaveResponse);

    expect(rebased.content).toContain("first.pdf");
    expect(rebased.content).toContain("second.pdf");
    expect(rebased.updatedAt).toBe(olderSaveResponse.updatedAt);
    expect(
      hasUnsavedLocalDraftChanges(rebased, buildReloadDraftSnapshot(olderSaveResponse))
    ).toBe(true);
  });
});
