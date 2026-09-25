/**
 * @jest-environment node
 */

import {
  coerceRowValues,
  defaultLogDocument,
  emptyRowValues,
  missingRequiredFields,
  normalizeFields,
  normalizeLogDocument,
  type LogField,
} from "@/lib/log-contract";

const fields: LogField[] = [
  { id: "f1", name: "Exercise", type: "text", required: true },
  { id: "f2", name: "Weight", type: "number" },
  { id: "f3", name: "Done", type: "boolean" },
  { id: "f4", name: "Mood", type: "select", options: ["good", "bad"] },
];

describe("log contract", () => {
  it("seeds a default document with a starter schema and no rows", () => {
    const doc = defaultLogDocument();
    expect(doc.version).toBe(1);
    expect(doc.schema.fields.map((f) => f.id)).toEqual(["entry", "amount", "notes"]);
    expect(doc.schema.fields[0].required).toBe(true);
    expect(doc.rows).toEqual([]);
  });

  it("coerces submitted values to the schema field types", () => {
    const values = coerceRowValues(fields, {
      f1: "Squat",
      f2: "100",
      f3: "true",
      f4: "good",
    });
    expect(values).toEqual({ f1: "Squat", f2: 100, f3: true, f4: "good" });
  });

  it("coerces blank/invalid numbers to null and unknown booleans to false", () => {
    const values = coerceRowValues(fields, { f1: "x", f2: "", f3: undefined, f4: "" });
    expect(values.f2).toBeNull();
    expect(values.f3).toBe(false);
    expect(values.f4).toBeNull();
  });

  it("flags required fields that are missing or blank", () => {
    const missing = missingRequiredFields(fields, emptyRowValues(fields));
    expect(missing.map((f) => f.id)).toEqual(["f1"]);
    const ok = missingRequiredFields(fields, coerceRowValues(fields, { f1: "Squat" }));
    expect(ok).toEqual([]);
  });

  it("normalizes a corrupt sidecar into a valid document without throwing", () => {
    const doc = normalizeLogDocument({
      schema: { fields: [{ name: "Note", type: "banana" }, { type: "text" }] },
      rows: [{ values: { x: 1 } }, "garbage"],
    });
    // Bad type falls back to text; the field with no name is dropped.
    expect(doc.schema.fields).toHaveLength(1);
    expect(doc.schema.fields[0].type).toBe("text");
    expect(doc.schema.fields[0].id).toBeTruthy();
    // The one object row survives (reshaped); the string row is dropped.
    expect(doc.rows).toHaveLength(1);
    expect(doc.rows[0].id).toBeTruthy();
  });

  it("drops fields without names when normalizing an edited schema", () => {
    const normalized = normalizeFields([
      { name: "  ", type: "text" },
      { name: "Reps", type: "number" },
    ]);
    expect(normalized).toHaveLength(1);
    expect(normalized[0].name).toBe("Reps");
    expect(normalized[0].type).toBe("number");
  });
});
