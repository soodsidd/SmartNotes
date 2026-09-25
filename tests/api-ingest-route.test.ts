import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { POST as postIngest } from "@/app/api/ingest/route";
import { GET as getIngestDestinations } from "@/app/api/ingest/destinations/route";
import { POST as postEmailInbound } from "@/app/api/email/inbound/route";
import { GET as getNotebooks } from "@/app/api/notebooks/route";
import { GET as getNotebookSections } from "@/app/api/notebooks/[notebook]/sections/route";
import { invalidateVaultTreeCacheForTesting } from "@/server/vault/pages";
import {
  constantTimeTokenEqual,
  EMAIL_ENVELOPE_FROM_HEADER,
  firstSafeHttpUrl,
  MAX_RAW_EMAIL_BYTES,
  parseAllowedSenders,
  resetEmailInboundProcessStateForTesting,
  resolveEmailRouting,
  sanitizeEmailHtml,
  setEmailInboundTestHooksForTesting,
} from "@/server/email-inbound";
import { registerPortableNotebook } from "@/server/vault/notebook-registry";

const INGEST_TOKEN = "test-ingest-token";
const PUBLIC_INGRESS_HOST = "notes-inbound.lucidrss.com";
const INGEST_DESTINATIONS = JSON.stringify([
  { id: "notebook", label: "Notebook", notebookPath: "Notebook" },
  { id: "research", label: "Research Library", notebookPath: "Research" },
]);
const INGEST_DEFAULT_DESTINATION = "notebook";
const EMAIL_TOKEN = "test-email-token";
const ALLOWED_EMAIL_SENDER = "allowed.sender@example.com";

async function withIngestFixture(run: (vaultRoot: string) => Promise<void>) {
  const previousVault = process.env.SMART_NOTES_VAULT;
  const previousState = process.env.SMART_NOTES_STATE_DIR;
  const previousToken = process.env.SMART_NOTES_INGEST_TOKEN;
  const previousDestinations = process.env.SMART_NOTES_INGEST_DESTINATIONS;
  const previousDefaultDestination = process.env.SMART_NOTES_INGEST_DEFAULT_DESTINATION;
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "smart-notes-ingest-"));
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "smart-notes-ingest-state-"));

  process.env.SMART_NOTES_VAULT = vaultRoot;
  process.env.SMART_NOTES_STATE_DIR = stateDir;
  process.env.SMART_NOTES_INGEST_TOKEN = INGEST_TOKEN;
  process.env.SMART_NOTES_INGEST_DESTINATIONS = INGEST_DESTINATIONS;
  process.env.SMART_NOTES_INGEST_DEFAULT_DESTINATION = INGEST_DEFAULT_DESTINATION;

  try {
    await fs.mkdir(path.join(vaultRoot, "Notebook", "Section"), { recursive: true });
    await fs.mkdir(path.join(vaultRoot, "Notebook", "Inbox"), { recursive: true });
    await fs.mkdir(path.join(vaultRoot, "Research", "Sources"), { recursive: true });
    await run(vaultRoot);
  } finally {
    invalidateVaultTreeCacheForTesting();
    if (previousVault) {
      process.env.SMART_NOTES_VAULT = previousVault;
    } else {
      delete process.env.SMART_NOTES_VAULT;
    }
    if (previousState) {
      process.env.SMART_NOTES_STATE_DIR = previousState;
    } else {
      delete process.env.SMART_NOTES_STATE_DIR;
    }
    if (previousToken) {
      process.env.SMART_NOTES_INGEST_TOKEN = previousToken;
    } else {
      delete process.env.SMART_NOTES_INGEST_TOKEN;
    }
    if (previousDestinations) {
      process.env.SMART_NOTES_INGEST_DESTINATIONS = previousDestinations;
    } else {
      delete process.env.SMART_NOTES_INGEST_DESTINATIONS;
    }
    if (previousDefaultDestination) {
      process.env.SMART_NOTES_INGEST_DEFAULT_DESTINATION = previousDefaultDestination;
    } else {
      delete process.env.SMART_NOTES_INGEST_DEFAULT_DESTINATION;
    }
    await fs.rm(vaultRoot, { recursive: true, force: true });
    await fs.rm(stateDir, { recursive: true, force: true });
    delete (global as Record<string, unknown>)["_smartNotesIo"];
  }
}

function ingestRequest(body: unknown, headers: HeadersInit = {}) {
  return new Request("http://localhost/api/ingest", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function publicIngestRequest(body: unknown, headers: HeadersInit = {}) {
  // Mirrors the tunnel, which preserves the public Host on the origin request.
  return new Request(`https://${PUBLIC_INGRESS_HOST}/api/ingest`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function normalizedPayload(overrides: Record<string, unknown> = {}) {
  return {
    title: "Research Link",
    sourceUrl: "https://example.test/research",
    content: "<article><h1>Body</h1><p>Captured HTML.</p></article>",
    type: "article",
    author: "Ada Lovelace",
    publishedDate: "1843-01-01",
    tags: ["history", "computing", "history"],
    ...overrides,
  };
}

async function withEmailFixture(
  run: (vaultRoot: string, stateDir: string) => Promise<void>
) {
  const previousToken = process.env.SMART_NOTES_EMAIL_INBOUND_TOKEN;
  const previousAllowed = process.env.SMART_NOTES_EMAIL_ALLOWED_SENDERS;
  await withIngestFixture(async (vaultRoot) => {
    process.env.SMART_NOTES_EMAIL_INBOUND_TOKEN = EMAIL_TOKEN;
    process.env.SMART_NOTES_EMAIL_ALLOWED_SENDERS = ALLOWED_EMAIL_SENDER;
    resetEmailInboundProcessStateForTesting();
    try {
      await run(vaultRoot, process.env.SMART_NOTES_STATE_DIR!);
    } finally {
      resetEmailInboundProcessStateForTesting();
      if (previousToken === undefined) delete process.env.SMART_NOTES_EMAIL_INBOUND_TOKEN;
      else process.env.SMART_NOTES_EMAIL_INBOUND_TOKEN = previousToken;
      if (previousAllowed === undefined) delete process.env.SMART_NOTES_EMAIL_ALLOWED_SENDERS;
      else process.env.SMART_NOTES_EMAIL_ALLOWED_SENDERS = previousAllowed;
    }
  });
}

interface RawEmailOptions {
  from?: string;
  to?: string;
  subject?: string;
  messageId?: string | null;
  date?: string;
  contentType?: string;
  body?: string;
}

function rawEmail(options: RawEmailOptions = {}) {
  const headers = [
    `From: ${options.from ?? `Allowed Sender <${ALLOWED_EMAIL_SENDER}>`}`,
    `To: ${options.to ?? "notes@lucidrss.com"}`,
    `Subject: ${options.subject ?? "Email capture"}`,
    `Date: ${options.date ?? "Mon, 10 Aug 2026 12:34:56 -0700"}`,
    `Content-Type: ${options.contentType ?? "text/plain; charset=utf-8"}`,
  ];
  if (options.messageId !== null) {
    headers.push(`Message-ID: ${options.messageId ?? "<email-test@example.com>"}`);
  }
  return Buffer.from(`${headers.join("\r\n")}\r\n\r\n${options.body ?? "Email body"}`, "utf8");
}

function multipartEmail(options: Omit<RawEmailOptions, "contentType" | "body"> & {
  html?: string;
  attachmentOnly?: boolean;
}) {
  const boundary = "sn-212-boundary";
  const parts = options.attachmentOnly ? [] : [
    `--${boundary}`,
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    options.html ?? "<p>Email body</p>",
  ];
  parts.push(
    `--${boundary}`,
    "Content-Type: application/octet-stream; name=ignored.txt",
    "Content-Disposition: attachment; filename=ignored.txt",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from("attachment-secret-payload", "utf8").toString("base64"),
    `--${boundary}--`,
    ""
  );
  return rawEmail({
    ...options,
    contentType: `multipart/mixed; boundary=${boundary}`,
    body: parts.join("\r\n"),
  });
}

function emailRequest(raw: Buffer, headers: HeadersInit = {}) {
  return new Request("http://localhost/api/email/inbound", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${EMAIL_TOKEN}`,
      "Content-Type": "message/rfc822",
      [EMAIL_ENVELOPE_FROM_HEADER]: ALLOWED_EMAIL_SENDER,
      ...headers,
    },
    body: new Uint8Array(raw),
  });
}

async function listFilesRecursively(root: string, base = root): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursively(absolute, base)));
    } else {
      files.push(path.relative(base, absolute).replaceAll("\\", "/"));
    }
  }
  return files.sort();
}

describe("ingest route", () => {
  it("creates an HTML page through capturePage and writes sibling reference metadata", async () => {
    await withIngestFixture(async (vaultRoot) => {
      const response = await postIngest(
        ingestRequest(
          normalizedPayload({
            destination: {
              notebookPath: "Research",
              sectionPath: "Research/Sources",
            },
          }),
          { Authorization: `Bearer ${INGEST_TOKEN}` }
        )
      );

      expect(response.status).toBe(201);
      const json = (await response.json()) as {
        page: { path: string; sectionPath: string; content: string };
        reference: Record<string, unknown>;
      };
      expect(json.page).toMatchObject({
        path: "Research/Sources/research-link.html",
        sectionPath: "Research/Sources",
        content: "<article><h1>Body</h1><p>Captured HTML.</p></article>",
      });
      expect(json.reference).toEqual({
        version: 1,
        sourceUrl: "https://example.test/research",
        author: "Ada Lovelace",
        publishedDate: "1843-01-01",
        type: "article",
        tags: ["history", "computing"],
      });

      await expect(
        fs.readFile(path.join(vaultRoot, "Research", "Sources", "research-link.html"), "utf8")
      ).resolves.toContain("<article><h1>Body</h1><p>Captured HTML.</p></article>");
      const sidecar = JSON.parse(
        await fs.readFile(path.join(vaultRoot, "Research", "Sources", "research-link.ref.json"), "utf8")
      ) as Record<string, unknown>;
      expect(sidecar).toEqual(json.reference);
    });
  });

  it("routes an allowlisted destination id to that notebook, not the global Inbox", async () => {
    await withIngestFixture(async (vaultRoot) => {
      // "Notebook" sorts first, so a global-Inbox fallback would land there.
      const response = await postIngest(
        ingestRequest(
          normalizedPayload({
            title: "Allowlisted Note",
            destination: { id: "research" },
          }),
          { Authorization: `Bearer ${INGEST_TOKEN}` }
        )
      );

      expect(response.status).toBe(201);
      await expect(response.json()).resolves.toMatchObject({
        page: {
          path: "Research/Inbox/allowlisted-note.html",
          notebookPath: "Research",
          sectionPath: "Research/Inbox",
        },
      });
      await expect(
        fs.stat(path.join(vaultRoot, "Research", "Inbox", "allowlisted-note.ref.json"))
      ).resolves.toBeDefined();
    });
  });

  it("uses the configured default destination when the caller omits one", async () => {
    await withIngestFixture(async () => {
      const response = await postIngest(
        ingestRequest(normalizedPayload({ title: "Default Note" }), {
          Authorization: `Bearer ${INGEST_TOKEN}`,
        })
      );

      expect(response.status).toBe(201);
      await expect(response.json()).resolves.toMatchObject({
        page: { path: "Notebook/Inbox/default-note.html" },
      });
    });
  });

  it("rejects destinations outside the allowlist with 4xx and writes nothing (SN-234)", async () => {
    await withIngestFixture(async (vaultRoot) => {
      // Present on disk but never allowlisted — stands in for a registered
      // portable notebook (e.g. Abuela Key docs) that ingest must never reach.
      await fs.mkdir(path.join(vaultRoot, "Portable", "Inbox"), { recursive: true });
      invalidateVaultTreeCacheForTesting();
      const before = await listFilesRecursively(vaultRoot);

      const cases: Array<{ name: string; destination: unknown }> = [
        {
          // Pre-SN-234 this fell through to the global Inbox.
          name: "unknown notebook path",
          destination: {
            notebookPath: "Missing Notebook",
            sectionPath: "Missing Notebook/Missing Section",
          },
        },
        { name: "unknown id", destination: { id: "abuela-key-docs" } },
        {
          // A registered portable notebook that was never allowlisted.
          name: "unlisted notebook that exists on disk",
          destination: { notebookPath: "Portable" },
        },
        {
          // Section must stay inside the allowlisted notebook.
          name: "section outside the allowlisted notebook",
          destination: { id: "research", sectionPath: "Notebook/Inbox" },
        },
        {
          name: "traversal through an allowlisted notebook",
          destination: { id: "research", sectionPath: "Research/../Notebook/Inbox" },
        },
      ];

      for (const testCase of cases) {
        const response = await postIngest(
          ingestRequest(
            normalizedPayload({ title: `Rejected ${testCase.name}`, destination: testCase.destination }),
            { Authorization: `Bearer ${INGEST_TOKEN}` }
          )
        );
        expect([testCase.name, response.status]).toEqual([testCase.name, 403]);
        await expect(response.json()).resolves.toMatchObject({ code: "DESTINATION_NOT_ALLOWED" });
      }

      await expect(listFilesRecursively(vaultRoot)).resolves.toEqual(before);
    });
  });

  it("hard-errors instead of falling back when no default or no allowlist is configured", async () => {
    // Each scenario below mutates the env vars that seed the settings store.
    // Since SN-235 the settings store is seeded from env once per (fresh) state
    // dir and then becomes the source of truth, so each scenario needs its own
    // withIngestFixture call to get an unseeded state dir rather than relying on
    // an env var edit mid-run to take effect on the next request.

    // Allowlist with more than one entry and no configured default.
    await withIngestFixture(async () => {
      delete process.env.SMART_NOTES_INGEST_DEFAULT_DESTINATION;
      const noDefault = await postIngest(
        ingestRequest(normalizedPayload({ title: "No Default" }), {
          Authorization: `Bearer ${INGEST_TOKEN}`,
        })
      );
      expect(noDefault.status).toBe(400);
      await expect(noDefault.json()).resolves.toMatchObject({ code: "DESTINATION_REQUIRED" });
    });

    // An allowlist entry naming a notebook that does not exist is an operator
    // typo. It must fail closed rather than resolve somewhere else.
    await withIngestFixture(async (vaultRoot) => {
      const before = await listFilesRecursively(vaultRoot);
      process.env.SMART_NOTES_INGEST_DEFAULT_DESTINATION = "typo";
      process.env.SMART_NOTES_INGEST_DESTINATIONS = JSON.stringify([
        { id: "typo", label: "Typo", notebookPath: "Notebok" },
      ]);
      const missingNotebook = await postIngest(
        ingestRequest(normalizedPayload({ title: "Missing Notebook" }), {
          Authorization: `Bearer ${INGEST_TOKEN}`,
        })
      );
      expect(missingNotebook.status).toBe(404);
      await expect(missingNotebook.json()).resolves.toMatchObject({ code: "NOTEBOOK_NOT_FOUND" });
      await expect(listFilesRecursively(vaultRoot)).resolves.toEqual(before);
    });

    // No allowlist configured at all: external ingest fails closed.
    await withIngestFixture(async (vaultRoot) => {
      const before = await listFilesRecursively(vaultRoot);
      delete process.env.SMART_NOTES_INGEST_DESTINATIONS;
      delete process.env.SMART_NOTES_INGEST_DEFAULT_DESTINATION;
      const unconfigured = await postIngest(
        ingestRequest(normalizedPayload({ title: "Unconfigured", destination: { id: "research" } }), {
          Authorization: `Bearer ${INGEST_TOKEN}`,
        })
      );
      expect(unconfigured.status).toBe(503);
      await expect(unconfigured.json()).resolves.toMatchObject({
        code: "INGEST_DESTINATIONS_NOT_CONFIGURED",
      });

      await expect(listFilesRecursively(vaultRoot)).resolves.toEqual(before);

      // The local Android share target is not an external sender and keeps the
      // legacy capture path even with no allowlist configured.
      const shareTarget = await postIngest(
        ingestRequest(normalizedPayload({ title: "Share Target", type: "web" }), {
          Origin: "http://localhost",
        })
      );
      expect(shareTarget.status).toBe(201);
      await expect(shareTarget.json()).resolves.toMatchObject({
        page: { path: "Notebook/Inbox/share-target.html" },
      });
    });
  });

  it("requires bearer auth for external senders and exempts same-origin requests", async () => {
    await withIngestFixture(async () => {
      const unauthorized = await postIngest(ingestRequest(normalizedPayload()));
      expect(unauthorized.status).toBe(401);
      await expect(unauthorized.json()).resolves.toMatchObject({
        code: "UNAUTHORIZED",
      });

      const sameOrigin = await postIngest(
        ingestRequest(
          normalizedPayload({
            title: "Android Share",
            type: "web",
          }),
          { Origin: "http://localhost" }
        )
      );
      expect(sameOrigin.status).toBe(201);
      await expect(sameOrigin.json()).resolves.toMatchObject({
        page: {
          path: "Notebook/Inbox/android-share.html",
        },
      });
    });
  });

  it("never honours the same-origin exemption over public ingress (SN-166)", async () => {
    const previousHosts = process.env.SMART_NOTES_PUBLIC_INGRESS_HOSTS;
    process.env.SMART_NOTES_PUBLIC_INGRESS_HOSTS = PUBLIC_INGRESS_HOST;

    try {
      await withIngestFixture(async () => {
        // A non-browser client can set either same-origin signal at will, so
        // both must be rejected when the request arrives over the public host.
        const spoofedSecFetchSite = await postIngest(
          publicIngestRequest(normalizedPayload(), { "sec-fetch-site": "same-origin" })
        );
        expect(spoofedSecFetchSite.status).toBe(401);
        await expect(spoofedSecFetchSite.json()).resolves.toMatchObject({
          code: "UNAUTHORIZED",
        });

        const spoofedOrigin = await postIngest(
          publicIngestRequest(normalizedPayload(), { Origin: `https://${PUBLIC_INGRESS_HOST}` })
        );
        expect(spoofedOrigin.status).toBe(401);

        // Cloudflare edge markers alone are enough to require a bearer, even
        // if the ingress hostname allowlist is not configured.
        delete process.env.SMART_NOTES_PUBLIC_INGRESS_HOSTS;
        const edgeMarked = await postIngest(
          ingestRequest(normalizedPayload(), {
            "sec-fetch-site": "same-origin",
            "cf-ray": "8f2b1c4d5e6f7a8b-SEA",
          })
        );
        expect(edgeMarked.status).toBe(401);
        process.env.SMART_NOTES_PUBLIC_INGRESS_HOSTS = PUBLIC_INGRESS_HOST;

        // A valid bearer still works over the same public ingress.
        const authorized = await postIngest(
          publicIngestRequest(normalizedPayload({ title: "Public Ingest", type: "web" }), {
            Authorization: `Bearer ${INGEST_TOKEN}`,
          })
        );
        expect(authorized.status).toBe(201);
        await expect(authorized.json()).resolves.toMatchObject({
          page: {
            path: "Notebook/Inbox/public-ingest.html",
          },
        });
      });
    } finally {
      if (previousHosts) {
        process.env.SMART_NOTES_PUBLIC_INGRESS_HOSTS = previousHosts;
      } else {
        delete process.env.SMART_NOTES_PUBLIC_INGRESS_HOSTS;
      }
    }
  });
});

describe("ingest destinations catalog (SN-234)", () => {
  function destinationsRequest(headers: HeadersInit = {}) {
    return new Request("http://localhost/api/ingest/destinations", { headers });
  }

  it("requires the ingest bearer and does not honour the share-target exemption", async () => {
    await withIngestFixture(async () => {
      const anonymous = await getIngestDestinations(destinationsRequest());
      expect(anonymous.status).toBe(401);
      expect(anonymous.headers.get("WWW-Authenticate")).toBe("Bearer");
      await expect(anonymous.json()).resolves.toMatchObject({ code: "UNAUTHORIZED" });

      const wrongToken = await getIngestDestinations(
        destinationsRequest({ Authorization: "Bearer not-the-token" })
      );
      expect(wrongToken.status).toBe(401);

      // The catalog is a read surface for external senders only; the
      // Origin/sec-fetch-site exemption that POST keeps is not honoured here.
      const sameOrigin = await getIngestDestinations(
        destinationsRequest({ Origin: "http://localhost", "sec-fetch-site": "same-origin" })
      );
      expect(sameOrigin.status).toBe(401);
    });
  });

  it("returns only allowlisted id + label, never notebook paths or the vault tree", async () => {
    await withIngestFixture(async (vaultRoot) => {
      await fs.mkdir(path.join(vaultRoot, "Portable", "Inbox"), { recursive: true });
      invalidateVaultTreeCacheForTesting();

      const response = await getIngestDestinations(
        destinationsRequest({ Authorization: `Bearer ${INGEST_TOKEN}` })
      );
      expect(response.status).toBe(200);

      const body = (await response.json()) as {
        destinations: Array<Record<string, unknown>>;
        defaultId: string | null;
      };
      expect(body).toEqual({
        destinations: [
          { id: "notebook", label: "Notebook", isDefault: true },
          { id: "research", label: "Research Library", isDefault: false },
        ],
        defaultId: "notebook",
      });
      for (const entry of body.destinations) {
        expect(Object.keys(entry).sort()).toEqual(["id", "isDefault", "label"]);
      }
      // No vault paths, no sections, and no unlisted notebook is disclosed.
      const serialized = JSON.stringify(body);
      expect(serialized).not.toContain("Portable");
      expect(serialized).not.toContain("Sources");
      expect(serialized).not.toContain("notebookPath");
    });
  });

  it("reports no default when several destinations are configured without one", async () => {
    await withIngestFixture(async () => {
      delete process.env.SMART_NOTES_INGEST_DEFAULT_DESTINATION;
      const response = await getIngestDestinations(
        destinationsRequest({ Authorization: `Bearer ${INGEST_TOKEN}` })
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        defaultId: null,
        destinations: [
          { id: "notebook", isDefault: false },
          { id: "research", isDefault: false },
        ],
      });
    });
  });

  it("treats a single-entry allowlist as its own default", async () => {
    await withIngestFixture(async () => {
      delete process.env.SMART_NOTES_INGEST_DEFAULT_DESTINATION;
      process.env.SMART_NOTES_INGEST_DESTINATIONS = JSON.stringify([
        { id: "research", label: "Research Library", notebookPath: "Research" },
      ]);

      const response = await getIngestDestinations(
        destinationsRequest({ Authorization: `Bearer ${INGEST_TOKEN}` })
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ defaultId: "research" });

      const ingested = await postIngest(
        ingestRequest(normalizedPayload({ title: "Implicit Default" }), {
          Authorization: `Bearer ${INGEST_TOKEN}`,
        })
      );
      expect(ingested.status).toBe(201);
      await expect(ingested.json()).resolves.toMatchObject({
        page: { path: "Research/Inbox/implicit-default.html" },
      });
    });
  });

  it("surfaces misconfiguration as 503 instead of serving a partial allowlist", async () => {
    await withIngestFixture(async () => {
      const invalidConfigurations = [
        "not json",
        JSON.stringify({ id: "research" }),
        JSON.stringify([{ id: "research", label: "Research" }]),
        JSON.stringify([{ id: "research", label: "Research", notebookPath: "Research/Sources" }]),
        JSON.stringify([
          { id: "research", label: "Research", notebookPath: "Research" },
          { id: "Research", label: "Duplicate", notebookPath: "Notebook" },
        ]),
      ];

      for (const configuration of invalidConfigurations) {
        process.env.SMART_NOTES_INGEST_DESTINATIONS = configuration;
        const response = await getIngestDestinations(
          destinationsRequest({ Authorization: `Bearer ${INGEST_TOKEN}` })
        );
        expect([configuration, response.status]).toEqual([configuration, 503]);
        await expect(response.json()).resolves.toMatchObject({
          code: "INGEST_DESTINATIONS_NOT_CONFIGURED",
        });
      }

      // A default that is not itself allowlisted is configuration, not input.
      process.env.SMART_NOTES_INGEST_DESTINATIONS = INGEST_DESTINATIONS;
      process.env.SMART_NOTES_INGEST_DEFAULT_DESTINATION = "portable";
      const badDefault = await getIngestDestinations(
        destinationsRequest({ Authorization: `Bearer ${INGEST_TOKEN}` })
      );
      expect(badDefault.status).toBe(503);

      // Nothing configured at all.
      delete process.env.SMART_NOTES_INGEST_DESTINATIONS;
      delete process.env.SMART_NOTES_INGEST_DEFAULT_DESTINATION;
      const unconfigured = await getIngestDestinations(
        destinationsRequest({ Authorization: `Bearer ${INGEST_TOKEN}` })
      );
      expect(unconfigured.status).toBe(503);
    });
  });
});

describe("notebooks picker routes", () => {
  it("lists notebooks and sections from the vault tree", async () => {
    await withIngestFixture(async () => {
      const notebooksResponse = await getNotebooks();
      expect(notebooksResponse.status).toBe(200);
      await expect(notebooksResponse.json()).resolves.toMatchObject({
        notebooks: [
          { path: "Notebook", name: "Notebook" },
          { path: "Research", name: "Research" },
        ],
      });

      const sectionsResponse = await getNotebookSections(
        new Request("http://localhost/api/notebooks/Research/sections"),
        { params: { notebook: "Research" } }
      );
      expect(sectionsResponse.status).toBe(200);
      await expect(sectionsResponse.json()).resolves.toMatchObject({
        notebook: { path: "Research", name: "Research" },
        sections: [{ path: "Research/Sources", name: "Sources" }],
      });
    });
  });
});

describe("email inbound authentication and request limits", () => {
  it("requires configured bearer auth and compares tokens through fixed-length digests", async () => {
    await withEmailFixture(async () => {
      expect(constantTimeTokenEqual(EMAIL_TOKEN, EMAIL_TOKEN)).toBe(true);
      expect(constantTimeTokenEqual("x", EMAIL_TOKEN)).toBe(false);
      expect(constantTimeTokenEqual(`${EMAIL_TOKEN}-wrong`, EMAIL_TOKEN)).toBe(false);

      delete process.env.SMART_NOTES_EMAIL_INBOUND_TOKEN;
      const unconfigured = await postEmailInbound(emailRequest(rawEmail()));
      expect(unconfigured.status).toBe(503);
      await expect(unconfigured.json()).resolves.toMatchObject({ code: "EMAIL_INBOUND_UNCONFIGURED" });

      process.env.SMART_NOTES_EMAIL_INBOUND_TOKEN = EMAIL_TOKEN;
      const unauthorized = await postEmailInbound(emailRequest(rawEmail(), { Authorization: "Bearer wrong" }));
      expect(unauthorized.status).toBe(401);
      expect(unauthorized.headers.get("www-authenticate")).toBe("Bearer");

      const wrongContentType = await postEmailInbound(
        emailRequest(rawEmail(), { "Content-Type": "application/octet-stream" })
      );
      expect(wrongContentType.status).toBe(400);
      await expect(wrongContentType.json()).resolves.toMatchObject({ code: "INVALID_MIME" });
    });
  });

  it("authorizes the authenticated envelope sender and rejects missing, disallowed, or mismatched identities", async () => {
    await withEmailFixture(async () => {
      expect(parseAllowedSenders(` ${ALLOWED_EMAIL_SENDER.toUpperCase()} , second@example.com `)).toEqual(
        new Set([ALLOWED_EMAIL_SENDER, "second@example.com"])
      );

      const missingEnvelope = await postEmailInbound(emailRequest(rawEmail(), {
        [EMAIL_ENVELOPE_FROM_HEADER]: "",
      }));
      expect(missingEnvelope.status).toBe(403);
      await expect(missingEnvelope.json()).resolves.toMatchObject({ code: "ENVELOPE_SENDER_REQUIRED" });

      const disallowedEnvelope = await postEmailInbound(emailRequest(rawEmail(), {
        [EMAIL_ENVELOPE_FROM_HEADER]: "attacker@example.com",
      }));
      expect(disallowedEnvelope.status).toBe(403);
      await expect(disallowedEnvelope.json()).resolves.toMatchObject({ code: "SENDER_NOT_ALLOWED" });

      const mismatchedMimeFrom = await postEmailInbound(emailRequest(rawEmail({
        from: "attacker@example.com",
      })));
      expect(mismatchedMimeFrom.status).toBe(403);
      await expect(mismatchedMimeFrom.json()).resolves.toMatchObject({ code: "SENDER_MISMATCH" });
      expect(await listFilesRecursively(process.env.SMART_NOTES_VAULT!)).toEqual([]);

      const normalized = await postEmailInbound(emailRequest(rawEmail({
        from: ALLOWED_EMAIL_SENDER.toUpperCase(),
        messageId: "<normalized-envelope@example.com>",
      }), {
        [EMAIL_ENVELOPE_FROM_HEADER]: ` ${ALLOWED_EMAIL_SENDER.toUpperCase()} `,
      }));
      expect(normalized.status).toBe(201);
      await expect(normalized.json()).resolves.toMatchObject({
        reference: { email: { sender: ALLOWED_EMAIL_SENDER, envelopeSender: ALLOWED_EMAIL_SENDER } },
      });

      const multipleFrom = await postEmailInbound(emailRequest(rawEmail({
        from: `${ALLOWED_EMAIL_SENDER}, attacker@example.com`,
        messageId: "<multiple-from@example.com>",
      })));
      expect(multipleFrom.status).toBe(400);
      await expect(multipleFrom.json()).resolves.toMatchObject({ code: "INVALID_MIME" });

      delete process.env.SMART_NOTES_EMAIL_ALLOWED_SENDERS;
      const noAllowlist = await postEmailInbound(emailRequest(rawEmail()));
      expect(noAllowlist.status).toBe(503);
      await expect(noAllowlist.json()).resolves.toMatchObject({
        code: "EMAIL_ALLOWED_SENDERS_UNCONFIGURED",
      });
    });
  });

  it("rejects empty, invalid, attachment-only, and oversized messages with no vault writes", async () => {
    await withEmailFixture(async (vaultRoot) => {
      const empty = await postEmailInbound(emailRequest(Buffer.alloc(0)));
      expect(empty.status).toBe(400);

      const invalid = await postEmailInbound(emailRequest(Buffer.from("not an RFC 822 message")));
      expect(invalid.status).toBe(400);

      const attachmentOnly = await postEmailInbound(emailRequest(multipartEmail({
        subject: "Attachment only",
        messageId: "<attachment-only@example.com>",
        attachmentOnly: true,
      })));
      expect(attachmentOnly.status).toBe(400);
      await expect(attachmentOnly.json()).resolves.toMatchObject({ code: "EMPTY_EMAIL_BODY" });

      const oversized = await postEmailInbound(emailRequest(Buffer.alloc(MAX_RAW_EMAIL_BYTES + 1, 65)));
      expect(oversized.status).toBe(413);
      await expect(oversized.json()).resolves.toMatchObject({ code: "EMAIL_TOO_LARGE" });

      expect(await listFilesRecursively(vaultRoot)).toEqual([]);
    });
  });
});

describe("email MIME normalization and Inbox routing", () => {
  it("sanitizes preferred HTML, strips attachments, finds the first safe URL, and routes by exact notebook name", async () => {
    await withEmailFixture(async (vaultRoot) => {
      const raw = multipartEmail({
        subject: "rEsEaRcH, Quarterly review, Q3, final",
        messageId: "<routed-html@example.com>",
        html: [
          "<script>window.bad='https://script.example/ignored'</script>",
          "<h1 onclick=\"alert(1)\">Quarterly review</h1>",
          "<a href=\"javascript:alert(1)\">Unsafe</a>",
          "<a href=\"https://example.test/source?x=1&amp;y=2\">Source</a>",
          "<img src=\"https://tracker.example/pixel\" onerror=\"alert(1)\">",
          "<p>Usable HTML body.</p>",
        ].join(""),
      });

      const response = await postEmailInbound(emailRequest(raw));
      expect(response.status).toBe(201);
      const json = await response.json() as {
        created: boolean;
        id: string;
        page: { path: string; title: string; content: string; notebookPath: string; sectionPath: string };
        reference: Record<string, any>;
      };
      expect(json).toMatchObject({
        created: true,
        id: "Research/Inbox/quarterly-review-q3-final.html",
        page: {
          path: "Research/Inbox/quarterly-review-q3-final.html",
          title: "Quarterly review, Q3, final",
          notebookPath: "Research",
          sectionPath: "Research/Inbox",
        },
        reference: {
          sourceUrl: "https://example.test/source?x=1&y=2",
          type: "email",
          tags: ["email"],
          email: {
            messageId: "<routed-html@example.com>",
            sender: ALLOWED_EMAIL_SENDER,
            recipients: ["notes@lucidrss.com"],
            receivedAt: "2026-08-10T19:34:56.000Z",
            originalSubject: "rEsEaRcH, Quarterly review, Q3, final",
            routing: {
              requestedPrefix: "rEsEaRcH",
              matchedNotebookPath: "Research",
              fallbackReason: null,
            },
            ignoredAttachmentCount: 1,
            dedupeKind: "message-id",
          },
        },
      });
      expect(json.page.content).toContain("Usable HTML body.");
      expect(json.page.content).not.toMatch(/script|onclick|javascript:|<img|tracker\.example|attachment-secret/i);

      const files = await listFilesRecursively(vaultRoot);
      expect(files).toContain("Research/Inbox/quarterly-review-q3-final.html");
      expect(files).toContain("Research/Inbox/quarterly-review-q3-final.ref.json");
      expect(files.some((file) => /ignored|attachment/i.test(file))).toBe(false);
    });
  });

  it("escapes plain text, uses mailto for body-only email, and records no-prefix fallback", async () => {
    await withEmailFixture(async (vaultRoot) => {
      const response = await postEmailInbound(emailRequest(rawEmail({
        subject: "Plain body capture",
        messageId: "<plain-body@example.com>",
        body: "<b>literal text</b>\nnext line",
      })));
      expect(response.status).toBe(201);
      const json = await response.json() as { page: { path: string; content: string }; reference: Record<string, any> };
      expect(json.page.path).toBe("Notebook/Inbox/plain-body-capture.html");
      expect(json.page.content).toContain("&lt;b&gt;literal text&lt;/b&gt;<br />next line");
      expect(json.page.content).not.toContain("<b>literal text</b>");
      expect(json.reference.sourceUrl).toBe(`mailto:${ALLOWED_EMAIL_SENDER}`);
      expect(json.reference.email.routing).toEqual({
        requestedPrefix: null,
        matchedNotebookPath: null,
        fallbackReason: "no-prefix",
      });

      const sidecar = JSON.parse(
        await fs.readFile(path.join(vaultRoot, "Notebook", "Inbox", "plain-body-capture.ref.json"), "utf8")
      );
      expect(sidecar).toEqual(json.reference);
    });
  });

  it("preserves unresolved and ambiguous directives in the global Inbox without fuzzy matching", async () => {
    await withEmailFixture(async (vaultRoot, stateDir) => {
      const portableRootOne = await fs.mkdtemp(path.join(os.tmpdir(), "sn-email-shared-one-"));
      const portableRootTwo = await fs.mkdtemp(path.join(os.tmpdir(), "sn-email-shared-two-"));
      try {
        registerPortableNotebook(portableRootOne, "Shared", stateDir);
        registerPortableNotebook(portableRootTwo, "Shared", stateDir);
        invalidateVaultTreeCacheForTesting();

        const ambiguousRouting = await resolveEmailRouting("shared, Ambiguous title, kept");
        expect(ambiguousRouting).toMatchObject({
          title: "shared, Ambiguous title, kept",
          metadata: { requestedPrefix: "shared", fallbackReason: "ambiguous" },
        });

        const unresolved = await postEmailInbound(emailRequest(rawEmail({
          subject: "Resear, Keep original, commas",
          messageId: "<unresolved@example.com>",
        })));
        expect(unresolved.status).toBe(201);
        await expect(unresolved.json()).resolves.toMatchObject({
          page: {
            title: "Resear, Keep original, commas",
            path: "Notebook/Inbox/resear-keep-original-commas.html",
          },
          reference: {
            email: {
              routing: {
                requestedPrefix: "Resear",
                matchedNotebookPath: null,
                fallbackReason: "unresolved",
              },
            },
          },
        });

        const ambiguous = await postEmailInbound(emailRequest(rawEmail({
          subject: "Shared, Keep ambiguous subject",
          messageId: "<ambiguous@example.com>",
        })));
        expect(ambiguous.status).toBe(201);
        await expect(ambiguous.json()).resolves.toMatchObject({
          page: {
            title: "Shared, Keep ambiguous subject",
            path: "Notebook/Inbox/shared-keep-ambiguous-subject.html",
          },
          reference: { email: { routing: { fallbackReason: "ambiguous" } } },
        });
        expect(await fs.stat(path.join(vaultRoot, "Notebook", "Inbox"))).toBeDefined();
      } finally {
        await fs.rm(portableRootOne, { recursive: true, force: true });
        await fs.rm(portableRootTwo, { recursive: true, force: true });
      }
    });
  });

  it("preserves subjects with an empty routing prefix or title and records the fallback reason", async () => {
    await withEmailFixture(async () => {
      const emptyPrefix = await postEmailInbound(emailRequest(rawEmail({
        subject: ", Keep original",
        messageId: "<empty-prefix@example.com>",
      })));
      expect(emptyPrefix.status).toBe(201);
      await expect(emptyPrefix.json()).resolves.toMatchObject({
        page: { title: ", Keep original", path: "Notebook/Inbox/keep-original.html" },
        reference: {
          email: {
            routing: { requestedPrefix: "", matchedNotebookPath: null, fallbackReason: "empty-prefix" },
          },
        },
      });

      const emptyTitle = await postEmailInbound(emailRequest(rawEmail({
        subject: "Research, ",
        messageId: "<empty-title@example.com>",
      })));
      expect(emptyTitle.status).toBe(201);
      await expect(emptyTitle.json()).resolves.toMatchObject({
        page: { title: "Research,", path: "Notebook/Inbox/research.html" },
        reference: {
          email: {
            routing: { requestedPrefix: "Research", matchedNotebookPath: null, fallbackReason: "empty-title" },
          },
        },
      });
    });
  });

  it("creates the global Inbox in the first notebook alphabetically, or Personal Notebook for an empty vault", async () => {
    await withEmailFixture(async (vaultRoot) => {
      await fs.rm(path.join(vaultRoot, "Notebook"), { recursive: true, force: true });
      await fs.rm(path.join(vaultRoot, "Research"), { recursive: true, force: true });
      await fs.mkdir(path.join(vaultRoot, "Zulu"), { recursive: true });
      await fs.mkdir(path.join(vaultRoot, "Alpha"), { recursive: true });
      invalidateVaultTreeCacheForTesting();

      const alphabetical = await postEmailInbound(emailRequest(rawEmail({
        subject: "Alphabetical fallback",
        messageId: "<alphabetical@example.com>",
      })));
      expect(alphabetical.status).toBe(201);
      await expect(alphabetical.json()).resolves.toMatchObject({
        page: { path: "Alpha/Inbox/alphabetical-fallback.html" },
      });

      await fs.rm(path.join(vaultRoot, "Alpha"), { recursive: true, force: true });
      await fs.rm(path.join(vaultRoot, "Zulu"), { recursive: true, force: true });
      invalidateVaultTreeCacheForTesting();
      const emptyVault = await postEmailInbound(emailRequest(rawEmail({
        subject: "Empty vault fallback",
        messageId: "<empty-vault@example.com>",
      })));
      expect(emptyVault.status).toBe(201);
      await expect(emptyVault.json()).resolves.toMatchObject({
        page: { path: "Personal Notebook/Inbox/empty-vault-fallback.html" },
      });
    });
  });

  it("matches portable notebooks by exact display name or vault path, case-insensitively", async () => {
    await withEmailFixture(async (_vaultRoot, stateDir) => {
      const portableRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sn-email-portable-"));
      try {
        const portable = registerPortableNotebook(portableRoot, "Team Notes", stateDir);
        invalidateVaultTreeCacheForTesting();
        await expect(resolveEmailRouting("TEAM NOTES, Display match, commas stay")).resolves.toMatchObject({
          title: "Display match, commas stay",
          notebookPath: `+${portable.id}`,
          metadata: { fallbackReason: null },
        });
        await expect(resolveEmailRouting(`+${portable.id.toUpperCase()}, Path match`)).resolves.toMatchObject({
          title: "Path match",
          notebookPath: `+${portable.id}`,
          metadata: { fallbackReason: null },
        });
      } finally {
        await fs.rm(portableRoot, { recursive: true, force: true });
      }
    });
  });

  it("accepts only credential-free HTTP(S) source URLs from sanitized content", () => {
    const sanitized = sanitizeEmailHtml(
      "<script>https://script.example/bad</script>" +
      "<a href=\"javascript:alert(1)\">bad</a>" +
      "<p>https://user:pass@example.test/secret then https://safe.example/path.</p>"
    );
    expect(sanitized).not.toMatch(/script|javascript:/i);
    expect(firstSafeHttpUrl(sanitized)).toBe("https://safe.example/path");
  });
});

describe("email durable idempotency and atomic writes", () => {
  it("deduplicates Message-ID and raw-MIME hash deliveries across process-state resets", async () => {
    await withEmailFixture(async (vaultRoot, stateDir) => {
      const messageIdRaw = rawEmail({
        subject: "Message id once",
        messageId: "<dedupe-message@example.com>",
      });
      const first = await postEmailInbound(emailRequest(messageIdRaw));
      expect(first.status).toBe(201);
      const firstJson = await first.json() as { id: string };

      resetEmailInboundProcessStateForTesting();
      const replay = await postEmailInbound(emailRequest(messageIdRaw));
      expect(replay.status).toBe(200);
      await expect(replay.json()).resolves.toMatchObject({ created: false, id: firstJson.id });

      const hashRaw = rawEmail({ subject: "Hash once", messageId: null, body: "Hash body" });
      const hashFirst = await postEmailInbound(emailRequest(hashRaw));
      expect(hashFirst.status).toBe(201);
      const hashFirstJson = await hashFirst.json() as { id: string; reference: Record<string, any> };
      expect(hashFirstJson.reference.email.dedupeKind).toBe("raw-mime-sha256");

      resetEmailInboundProcessStateForTesting();
      const hashReplay = await postEmailInbound(emailRequest(hashRaw));
      expect(hashReplay.status).toBe(200);
      await expect(hashReplay.json()).resolves.toMatchObject({ created: false, id: hashFirstJson.id });

      const vaultFiles = (await listFilesRecursively(vaultRoot)).filter((file) => /message-id-once|hash-once/.test(file));
      expect(vaultFiles).toHaveLength(4);
      const dedupeFiles = (await listFilesRecursively(path.join(stateDir, "email-inbound", "dedupe")))
        .filter((file) => file.endsWith(".json"));
      expect(dedupeFiles).toHaveLength(2);
    });
  });

  it("rolls back page, reference, and dedupe files when a vault transaction fails", async () => {
    await withEmailFixture(async (vaultRoot, stateDir) => {
      const raw = rawEmail({
        subject: "Atomic failure",
        messageId: "<atomic-failure@example.com>",
      });
      setEmailInboundTestHooksForTesting({
        beforeCommitFile: (_file, index) => {
          if (index === 2) throw new Error("simulated dedupe commit failure");
        },
      });
      const failed = await postEmailInbound(emailRequest(raw));
      expect(failed.status).toBe(500);
      await expect(failed.json()).resolves.toMatchObject({ code: "VAULT_WRITE_FAILED" });

      expect((await listFilesRecursively(vaultRoot)).filter((file) => /atomic-failure/.test(file))).toEqual([]);
      expect(await listFilesRecursively(path.join(stateDir, "email-inbound"))).toEqual([]);

      resetEmailInboundProcessStateForTesting();
      const retry = await postEmailInbound(emailRequest(raw));
      expect(retry.status).toBe(201);
      await expect(retry.json()).resolves.toMatchObject({ created: true });
    });
  });
});
