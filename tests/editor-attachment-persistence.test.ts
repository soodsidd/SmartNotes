import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Editor } from "@tiptap/core";
import { JSDOM } from "jsdom";
import {
  createEditorExtensions,
  insertAndPersistUploadedEditorAsset,
  insertUploadedEditorAsset,
} from "@/lib/rich-text-editor-config";
import {
  awaitActiveSaveThenFlush,
  buildReloadDraftSnapshot,
  hasUnsavedLocalDraftChanges,
  rebaseDraftAfterSave,
} from "@/lib/page-reload";
import type { ApiPageDocument } from "@/lib/vault-contract";
import { resolvePdfAttachmentTarget } from "@/lib/pdf-attachment";
import { uploadPageAsset } from "@/server/vault/assets";
import { createPage, readPage, savePage } from "@/server/vault/pages";

const LONG_PDF_NAME =
  "Precision Engineering - Ultraprecision Mechanism Design, Bearings, and Motion Systems (Working Copy Rev 12).pdf";

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
  it("persists a new page's first attachment with a long filename through save, reload, and reader resolution", async () => {
    await withVaultFixture(async () => {
      const created = await createPage({
        sectionPath: "Notebook/Section",
        title: "Ultraprecision Mechanism Design",
      });
      expect((await readPage(created.path)).body).not.toContain("data-file-attachment");

      const asset = await uploadPageAsset(
        created.path,
        LONG_PDF_NAME,
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
        const html = await insertAndPersistUploadedEditorAsset(
          editor,
          asset,
          LONG_PDF_NAME,
          (nextHtml) => {
            publishedHtml = nextHtml;
          },
          async (nextHtml) => {
            const saved = await savePage({
              path: created.path,
              title: created.title,
              body: nextHtml,
            });
            return saved.body.includes(asset.url);
          }
        );
        expect(html).toContain('data-file-attachment=""');
        expect(html).toContain(asset.url);
        expect(html).toContain(LONG_PDF_NAME);
        expect(publishedHtml).toBe(html);

        const reloaded = await readPage(created.path);
        expect(reloaded.body).toContain('data-file-type="pdf"');
        expect(reloaded.body).toContain(asset.url);
        expect(reloaded.body.match(/data-file-attachment/g)).toHaveLength(1);

        const persisted = document.createElement("div");
        persisted.innerHTML = reloaded.body;
        const readerTarget = resolvePdfAttachmentTarget(
          persisted.querySelector(".file-attachment-name")
        );
        expect(readerTarget).toEqual({ href: asset.url, fileName: LONG_PDF_NAME });
      } finally {
        editor.destroy();
        element.remove();
      }
    });
  });

  it("does not complete a PDF attachment until durable persistence resolves", async () => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const editor = new Editor({
      element,
      extensions: createEditorExtensions(),
      content: "<p></p>",
    });
    let resolvePersistence!: (saved: boolean) => void;
    const persistence = new Promise<boolean>((resolve) => {
      resolvePersistence = resolve;
    });
    let completed = false;

    try {
      const completion = insertAndPersistUploadedEditorAsset(
        editor,
        {
          url: "/vault/Notebook/Section/page.assets/waiting.pdf",
          path: "Notebook/Section/page.assets/waiting.pdf",
          fileName: "waiting.pdf",
          isImage: false,
        },
        "waiting.pdf",
        () => undefined,
        () => persistence
      ).then((html) => {
        completed = true;
        return html;
      });

      await Promise.resolve();
      expect(completed).toBe(false);
      resolvePersistence(true);
      await expect(completion).resolves.toContain("waiting.pdf");
      expect(completed).toBe(true);
    } finally {
      editor.destroy();
      element.remove();
    }
  });

  it("waits for an older in-flight save before flushing the attachment draft", async () => {
    let resolveOlderSave!: (saved: boolean) => void;
    const olderSave = new Promise<boolean>((resolve) => {
      resolveOlderSave = resolve;
    });
    const flushAttachmentDraft = jest.fn(async () => true);
    let completed = false;

    const completion = awaitActiveSaveThenFlush(olderSave, flushAttachmentDraft).then(
      (saved) => {
        completed = true;
        return saved;
      }
    );

    await Promise.resolve();
    expect(completed).toBe(false);
    expect(flushAttachmentDraft).not.toHaveBeenCalled();

    resolveOlderSave(true);
    await expect(completion).resolves.toBe(true);
    expect(flushAttachmentDraft).toHaveBeenCalledTimes(1);
  });

  it("reveals the recoverable asset path when the page write fails", async () => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const editor = new Editor({
      element,
      extensions: createEditorExtensions(),
      content: "<p></p>",
    });
    const recoveryPath = "Notebook/Section/page.assets/recover-this-upload.pdf";
    const publishHtml = jest.fn();

    try {
      await expect(
        insertAndPersistUploadedEditorAsset(
          editor,
          {
            url: `/vault/${recoveryPath}`,
            path: recoveryPath,
            fileName: "recover-this-upload.pdf",
            isImage: false,
          },
          "recover-this-upload.pdf",
          publishHtml,
          async () => false
        )
      ).rejects.toThrow(recoveryPath);
      expect(editor.getHTML()).toContain("recover-this-upload.pdf");
      expect(publishHtml).toHaveBeenCalledWith(
        expect.stringContaining("recover-this-upload.pdf")
      );
    } finally {
      editor.destroy();
      element.remove();
    }
  });

  it("keeps image insertion on the existing non-blocking path", async () => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const editor = new Editor({
      element,
      extensions: createEditorExtensions(),
      content: "<p></p>",
    });
    const persistHtml = jest.fn(async () => false);

    try {
      await expect(
        insertAndPersistUploadedEditorAsset(
          editor,
          {
            url: "/vault/Notebook/Section/page.assets/diagram.png",
            path: "Notebook/Section/page.assets/diagram.png",
            fileName: "diagram.png",
            isImage: true,
          },
          "diagram.png",
          () => undefined,
          persistHtml
        )
      ).resolves.toContain("diagram.png");
      expect(persistHtml).not.toHaveBeenCalled();
    } finally {
      editor.destroy();
      element.remove();
    }
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
