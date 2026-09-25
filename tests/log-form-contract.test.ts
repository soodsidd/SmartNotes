/**
 * @jest-environment node
 */

import {
  defaultLogFormDefinition,
  fieldsFromJsonSchema,
  formDefinitionFromFields,
  initializeFormData,
  normalizeLogFormDefinition,
  parseLogFormSource,
  serializeLogFormSource,
  validateLogFormDefinitionForWrite,
} from "@/lib/log-form-contract";
import type { LogField } from "@/lib/log-contract";
import { coerceImageAssetValue } from "@/lib/log-contract";

describe("log form contract (JSON Forms script)", () => {
  it("round-trips explicit history suggestion metadata and validates schema field ids", () => {
    const base = defaultLogFormDefinition();
    const withSuggestion = validateLogFormDefinitionForWrite({
      ...base,
      historySuggestion: {
        matchFields: ["entry"],
        copyFields: ["amount", "notes"],
      },
    });

    expect(withSuggestion.historySuggestion).toEqual({
      matchFields: ["entry"],
      copyFields: ["amount", "notes"],
    });
    expect(JSON.parse(serializeLogFormSource(withSuggestion)).historySuggestion).toEqual(
      withSuggestion.historySuggestion
    );
    expect(() => validateLogFormDefinitionForWrite({
      ...base,
      historySuggestion: {
        matchFields: ["missing"],
        copyFields: ["amount"],
      },
    })).toThrow(/schema property/i);
    expect(normalizeLogFormDefinition({
      ...base,
      historySuggestion: {
        matchFields: ["entry"],
        copyFields: ["missing"],
      },
    }).historySuggestion).toBeUndefined();
  });

  it("round-trips validated named views and drops invalid views on defensive reads", () => {
    const input = {
      version: 1,
      schema: {
        type: "object",
        properties: { amount: { type: "number", title: "Amount" } },
      },
      uischema: { type: "VerticalLayout", elements: [] },
      views: [{
        id: "monthly",
        name: "Monthly totals",
        columns: [{ field: "amount", label: "Total", unit: "kg", format: "number" }],
        summaries: [{ operator: "sum", field: "amount", as: "total", unit: "kg" }],
        grouping: ["amount"],
        presentation: "grouped",
      }],
    };
    const validated = validateLogFormDefinitionForWrite(input);
    expect(validated.views?.[0]).toMatchObject({ id: "monthly", presentation: "grouped" });
    expect(JSON.parse(serializeLogFormSource(validated)).views[0].columns[0].unit).toBe("kg");
    expect(normalizeLogFormDefinition({ ...input, views: [{ id: "bad", name: "Bad", columns: [{ field: "missing" }] }] }).views).toBeUndefined();
  });

  it("rejects malformed or executable saved view specifications on writes", () => {
    const base = defaultLogFormDefinition();
    expect(() => validateLogFormDefinitionForWrite({
      ...base,
      views: [{ id: "unsafe", name: "Unsafe", columns: [{ field: "entry" }], sql: "select *" }],
    })).toThrow(/unsupported key/i);
    expect(() => validateLogFormDefinitionForWrite({
      ...base,
      views: [{ id: "unsafe", name: "Unsafe", columns: [{ field: "entry", format: "html" }] }],
    })).toThrow(/allowlisted/i);
  });

  it("round-trips only safe internal History actions that reference validated views", () => {
    const base = defaultLogFormDefinition();
    const view = {
      id: "trend",
      name: "Trend",
      columns: [{ field: "amount" }],
      presentation: "timeline" as const,
    };
    const validated = validateLogFormDefinitionForWrite({
      ...base,
      views: [view],
      actions: [{ type: "open-history", label: "View trend", view: "trend" }],
    });
    expect(validated.actions).toEqual([
      { type: "open-history", label: "View trend", view: "trend" },
    ]);
    expect(JSON.parse(serializeLogFormSource(validated)).actions).toEqual(validated.actions);

    expect(() => validateLogFormDefinitionForWrite({
      ...base,
      views: [view],
      actions: [{ type: "open-history", label: "Unsafe", view: "trend", href: "javascript:alert(1)" }],
    })).toThrow(/unsupported key/i);
    expect(() => validateLogFormDefinitionForWrite({
      ...base,
      views: [view],
      actions: [{ type: "open-history", label: "Missing", view: "missing" }],
    })).toThrow(/valid named view/i);
    expect(normalizeLogFormDefinition({
      ...base,
      views: [view],
      actions: [{ type: "run-code", label: "Nope", view: "trend" }],
    }).actions).toBeUndefined();
  });
  it("seeds a default form with schema + uischema", () => {
    const form = defaultLogFormDefinition();
    expect(form.version).toBe(1);
    expect(form.schema.type).toBe("object");
    expect(form.schema.properties).toHaveProperty("entry");
    expect(form.uischema.type).toBe("VerticalLayout");
  });

  it("projects JSON Schema properties into flat table fields", () => {
    const fields = fieldsFromJsonSchema({
      type: "object",
      properties: {
        exercise: { type: "string", title: "Exercise" },
        weight: { type: "number", title: "Weight" },
        done: { type: "boolean", title: "Done" },
        mood: { type: "string", title: "Mood", enum: ["good", "bad"] },
        when: { type: "string", format: "date", title: "When" },
      },
      required: ["exercise"],
    });
    expect(fields.map((f) => ({ id: f.id, type: f.type, required: !!f.required }))).toEqual([
      { id: "exercise", type: "text", required: true },
      { id: "weight", type: "number", required: false },
      { id: "done", type: "boolean", required: false },
      { id: "mood", type: "select", required: false },
      { id: "when", type: "date", required: false },
    ]);
    expect(fields.find((f) => f.id === "mood")?.options).toEqual(["good", "bad"]);
  });

  it("round-trips flat fields into a form definition and back", () => {
    const fields: LogField[] = [
      { id: "entry", name: "Entry", type: "text", required: true },
      { id: "amount", name: "Amount", type: "number" },
    ];
    const form = formDefinitionFromFields(fields);
    const projected = fieldsFromJsonSchema(form.schema);
    expect(projected.map((f) => f.id)).toEqual(["entry", "amount"]);
    expect(projected[0].required).toBe(true);
    expect(projected[1].type).toBe("number");
  });

  it("serializes and parses Source-tab text", () => {
    const form = defaultLogFormDefinition();
    const text = serializeLogFormSource(form);
    const parsed = parseLogFormSource(text);
    expect(parsed.schema.properties).toHaveProperty("entry");
    expect(parsed.uischema.type).toBe("VerticalLayout");
  });

  it("rejects invalid Source JSON loudly", () => {
    expect(() => parseLogFormSource("{not json")).toThrow(/valid JSON/i);
    expect(() => parseLogFormSource(JSON.stringify({ schema: {} }))).toThrow(/uischema/i);
  });

  it("normalizes corrupt form sidecars without throwing", () => {
    const form = normalizeLogFormDefinition({ schema: "nope", uischema: null });
    expect(form.schema.type).toBe("object");
    expect(form.uischema.type).toBe("VerticalLayout");
  });

  it("recursively initializes static defaults, including nested objects and array-default rows", () => {
    const schema = {
      type: "object",
      default: { source: "root default" },
      properties: {
        source: { type: "string" },
        mood: { type: "string", default: "steady" },
        settings: {
          type: "object",
          default: { timezone: "UTC" },
          properties: {
            units: { type: "string", default: "metric" },
            enabled: { type: "boolean", default: true },
            timezone: { type: "string" },
          },
        },
        sets: {
          type: "array",
          default: [{ reps: 8 }, {}],
          items: {
            type: "object",
            properties: {
              reps: { type: "number", default: 5 },
              complete: { type: "boolean", default: false },
            },
          },
        },
      },
    };

    const initialized = initializeFormData(schema);
    expect(initialized).toEqual({
      source: "root default",
      mood: "steady",
      settings: { timezone: "UTC", units: "metric", enabled: true },
      sets: [
        { reps: 8, complete: false },
        { reps: 5, complete: false },
      ],
    });

    (initialized.settings as Record<string, unknown>).units = "imperial";
    ((initialized.sets as Array<Record<string, unknown>>)[0]).reps = 10;
    expect(initializeFormData(schema)).toEqual({
      source: "root default",
      mood: "steady",
      settings: { timezone: "UTC", units: "metric", enabled: true },
      sets: [
        { reps: 8, complete: false },
        { reps: 5, complete: false },
      ],
    });
  });

  it("keeps restored draft and manual values authoritative while filling only absent defaults", () => {
    const draft = {
      mood: "",
      count: 0,
      note: null,
      settings: { units: "imperial" },
      sets: [],
    };
    const initialized = initializeFormData({
      type: "object",
      properties: {
        mood: { type: "string", default: "steady" },
        count: { type: "number", default: 3 },
        note: { type: "string", default: "schema note" },
        settings: {
          type: "object",
          default: { units: "metric", mode: "automatic" },
          properties: {
            units: { type: "string", default: "metric" },
            mode: { type: "string" },
            enabled: { type: "boolean", default: true },
          },
        },
        sets: {
          type: "array",
          default: [{ reps: 5 }],
          items: { type: "object", properties: { reps: { type: "number", default: 5 } } },
        },
      },
    }, draft);

    expect(initialized).toEqual({
      mood: "",
      count: 0,
      note: null,
      settings: { units: "imperial", mode: "automatic", enabled: true },
      sets: [],
    });
    expect(draft).toEqual({
      mood: "",
      count: 0,
      note: null,
      settings: { units: "imperial" },
      sets: [],
    });
  });

  it("projects image and multi-image JSON Schema conventions for URL-only row coercion", () => {
    const fields = fieldsFromJsonSchema({
      type: "object",
      properties: {
        cover: { type: "string", format: "image", title: "Cover" },
        poses: { type: "array", title: "Workout poses", items: { type: "string", format: "image" } },
      },
    });
    expect(fields.map((field) => field.type)).toEqual(["image", "image-sequence"]);
    expect(coerceImageAssetValue("/vault/Notebook/Section/workout.assets/cover.png", false)).toBe(
      "/vault/Notebook/Section/workout.assets/cover.png"
    );
    expect(coerceImageAssetValue("data:image/png;base64,aGVsbG8=", false)).toBeNull();
    expect(coerceImageAssetValue([
      "/vault/Notebook/Section/workout.assets/pose-1.png",
      "https://example.com/pose-2.png",
      "data:image/png;base64,aGVsbG8=",
    ], true)).toEqual(["/vault/Notebook/Section/workout.assets/pose-1.png"]);
  });
});
