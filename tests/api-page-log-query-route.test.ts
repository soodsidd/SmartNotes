import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { GET, POST } from "@/app/api/page/log/query/route";
import { PUT as FORM_PUT } from "@/app/api/page/log/route";
import LogFocusedPage from "@/app/log/page";
import { FocusedLogShell } from "@/components/focused-log-shell";
import { appendLogRow, createPage, saveLogFormDefinition } from "@/server/vault/pages";

async function withVault(run: (root: string) => Promise<void>) {
  const previous = process.env.SMART_NOTES_VAULT;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sn-147-log-query-"));
  process.env.SMART_NOTES_VAULT = root;
  try {
    await fs.mkdir(path.join(root, "Notebook", "Section"), { recursive: true });
    await run(root);
  } finally {
    if (previous) process.env.SMART_NOTES_VAULT = previous;
    else delete process.env.SMART_NOTES_VAULT;
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function seed() {
  const page = await createPage({ sectionPath: "Notebook/Section", title: "Metrics", noteType: "log" });
  await saveLogFormDefinition(page.path, {
    version: 1,
    schema: {
      type: "object",
      properties: {
        kind: { type: "string", title: "Kind" },
        amount: { type: "number", title: "Amount" },
      },
    },
    uischema: { type: "VerticalLayout", elements: [] },
    views: [{
      id: "runs",
      name: "Runs",
      filters: [{ field: "kind", operator: "eq", value: "run" }],
      columns: [
        { field: "kind", label: "Activity" },
        { field: "amount", label: "Distance", unit: "km", format: "number" },
      ],
      sort: [{ field: "amount", direction: "desc" }],
      summaries: [{ operator: "sum", field: "amount", as: "total_distance", unit: "km" }],
      presentation: "table",
      limit: 20,
    }],
  });
  await appendLogRow(page.path, { kind: "run", amount: 5 });
  await appendLogRow(page.path, { kind: "ride", amount: 20 });
  return page.path;
}

describe("log query API (SN-147)", () => {
  it("runs an arbitrary bounded query and a named JSON view with stable URLs", async () => {
    await withVault(async () => {
      const logPath = await seed();
      const arbitrary = await POST(new Request("http://localhost/api/page/log/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: logPath, query: { fields: ["amount"], limit: 1 } }),
      }));
      expect(arbitrary.status).toBe(200);
      expect((await arbitrary.json()).rows).toHaveLength(1);

      const named = await GET(new Request(
        `http://localhost/api/page/log/query?path=${encodeURIComponent(logPath)}&view=runs`
      ));
      expect(named.status).toBe(200);
      const body = await named.json();
      expect(body.rows).toHaveLength(1);
      expect(body.aggregates.total_distance).toBe(5);
      expect(body.liveUrl).toBe(`/log?path=${encodeURIComponent(logPath)}&view=runs`);
      expect(body.csvUrl).toContain("format=csv");
    });
  });

  it("routes stable named links into the shared focused History tab without changing the ordinary form path", async () => {
    await withVault(async () => {
      const logPath = await seed();
      await appendLogRow(logPath, { kind: "run", amount: 8 });

      const namedView = await LogFocusedPage({
        searchParams: { path: logPath, view: "runs" },
      });
      expect(namedView.type).toBe(FocusedLogShell);
      expect(namedView.props).toMatchObject({
        pagePath: logPath,
        initialTab: "history",
        initialViewId: "runs",
      });

      const ordinary = await LogFocusedPage({ searchParams: { path: logPath } });
      expect(ordinary.type).toBe(FocusedLogShell);
      expect(ordinary.props).toMatchObject({
        pagePath: logPath,
        initialTab: "form",
        initialViewId: null,
      });
    });
  });

  it("exports the current default History result as JSON or labelled CSV", async () => {
    await withVault(async () => {
      const logPath = await seed();
      const json = await GET(new Request(
        `http://localhost/api/page/log/query?path=${encodeURIComponent(logPath)}`
      ));
      expect(json.status).toBe(200);
      expect(await json.json()).toMatchObject({
        isDefault: true,
        matchedCount: 2,
        returnedCount: 2,
        liveUrl: `/log?path=${encodeURIComponent(logPath)}&tab=history`,
        view: { name: "All entries", presentation: "timeline" },
      });

      const csv = await GET(new Request(
        `http://localhost/api/page/log/query?path=${encodeURIComponent(logPath)}&format=csv`
      ));
      expect(csv.status).toBe(200);
      expect(csv.headers.get("Content-Type")).toContain("text/csv");
      expect(await csv.text()).toContain("Kind,Amount");
    });
  });

  it("exports the current named result as labelled CSV", async () => {
    await withVault(async () => {
      const logPath = await seed();
      const response = await GET(new Request(
        `http://localhost/api/page/log/query?path=${encodeURIComponent(logPath)}&view=runs&format=csv`
      ));
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toContain("text/csv");
      expect(await response.text()).toContain("Activity,Distance\r\nrun,5");
    });
  });

  it("neutralizes formula-leading text in CSV while preserving numeric values", async () => {
    await withVault(async () => {
      const page = await createPage({ sectionPath: "Notebook/Section", title: "Unsafe CSV", noteType: "log" });
      await saveLogFormDefinition(page.path, {
        version: 1,
        schema: {
          type: "object",
          properties: {
            text: { type: "string" },
            amount: { type: "number" },
          },
        },
        uischema: { type: "VerticalLayout", elements: [] },
        views: [{
          id: "export",
          name: "Export",
          columns: [
            { field: "text", label: "=Injected header" },
            { field: "amount", label: "Amount" },
          ],
        }],
      });
      await appendLogRow(page.path, { text: "=HYPERLINK(\"https://example.test\")", amount: -12.5 });
      await appendLogRow(page.path, { text: "+SUM(1,1)", amount: 4 });
      await appendLogRow(page.path, { text: "-2+3", amount: 5 });
      await appendLogRow(page.path, { text: "@cmd", amount: 6 });

      const response = await GET(new Request(
        `http://localhost/api/page/log/query?path=${encodeURIComponent(page.path)}&view=export&format=csv`
      ));
      expect(response.status).toBe(200);
      expect(await response.text()).toBe(
        "'=Injected header,Amount\r\n" +
        "\"'=HYPERLINK(\"\"https://example.test\"\")\",-12.5\r\n" +
        "\"'+SUM(1,1)\",4\r\n" +
        "'-2+3,5\r\n" +
        "'@cmd,6\r\n"
      );
    });
  });

  it("rejects traversal and non-log scope paths", async () => {
    await withVault(async () => {
      const traversal = await POST(new Request("http://localhost/api/page/log/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: "../outside.html", query: {} }),
      }));
      expect(traversal.status).toBe(400);

      const text = await createPage({ sectionPath: "Notebook/Section", title: "Plain" });
      const wrongType = await POST(new Request("http://localhost/api/page/log/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: text.path, query: {} }),
      }));
      expect(wrongType.status).toBe(400);
    });
  });

  it("rejects unsupported formats, top-level keys, and ambiguous named/ad-hoc requests", async () => {
    await withVault(async () => {
      const logPath = await seed();
      const unsupportedFormat = await GET(new Request(
        `http://localhost/api/page/log/query?path=${encodeURIComponent(logPath)}&view=runs&format=html`
      ));
      expect(unsupportedFormat.status).toBe(400);

      for (const body of [
        { path: logPath, query: {}, sql: "select * from rows" },
        { path: logPath, query: {}, view: "runs" },
      ]) {
        const response = await POST(new Request("http://localhost/api/page/log/query", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }));
        expect(response.status).toBe(400);
      }
    });
  });

  it("returns a 400 when the form write contains a malformed saved view", async () => {
    await withVault(async () => {
      const logPath = await seed();
      const response = await FORM_PUT(new Request("http://localhost/api/page/log", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: logPath,
          form: {
            version: 1,
            schema: { type: "object", properties: { amount: { type: "number" } } },
            uischema: { type: "VerticalLayout", elements: [] },
            views: [{ id: "unsafe", name: "Unsafe", columns: [{ field: "amount" }], html: "<script />" }],
          },
        }),
      }));
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: "INVALID_LOG_VIEW" });
    });
  });

  it("degrades a missing or malformed row sidecar to an empty bounded result", async () => {
    await withVault(async (root) => {
      const logPath = await seed();
      const sidecar = path.join(root, logPath.replace(/\.html$/i, ".log.json"));
      await fs.writeFile(sidecar, "{broken json", "utf8");
      const response = await POST(new Request("http://localhost/api/page/log/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: logPath, query: {} }),
      }));
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ rows: [], matchedCount: 0, truncated: false });
      await fs.rm(sidecar);
      const missing = await POST(new Request("http://localhost/api/page/log/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: logPath, query: {} }),
      }));
      expect(missing.status).toBe(200);
      expect((await missing.json()).rows).toEqual([]);
    });
  });
});
