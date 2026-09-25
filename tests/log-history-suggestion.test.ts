/**
 * @jest-environment node
 */

import type { JsonSchema } from "@jsonforms/core";

import {
  applyLogHistorySuggestion,
  findLogHistorySuggestion,
} from "@/lib/log-history-suggestion";
import type { LogHistorySuggestionDefinition } from "@/lib/log-form-contract";
import type { LogRow } from "@/lib/log-contract";

const schema: JsonSchema = {
  type: "object",
  properties: {
    category: { type: "string", title: "Category" },
    amount: { type: "number", title: "Amount" },
    taken: { type: "boolean", title: "Taken" },
    notes: { type: "string", title: "Notes" },
    proof: { type: "string", format: "image", title: "Proof" },
    loggedOn: { type: "string", format: "date", title: "Logged on" },
  },
};

const definition: LogHistorySuggestionDefinition = {
  matchFields: ["category"],
  copyFields: ["amount", "taken", "notes"],
};

function row(
  id: string,
  createdAt: string,
  values: LogRow["values"]
): LogRow {
  return { id, createdAt, values };
}

describe("application-agnostic log history suggestions", () => {
  it("selects the newest matching row and keeps eligible zero/false values", () => {
    const suggestion = findLogHistorySuggestion(
      definition,
      schema,
      { category: "travel" },
      [
        row("r_old", "2026-07-01T12:00:00.000Z", {
          category: "travel",
          amount: 19,
          taken: true,
          notes: "Older",
        }),
        row("r_other", "2026-07-29T12:00:00.000Z", {
          category: "groceries",
          amount: 50,
          taken: true,
          notes: "Wrong category",
        }),
        row("r_new", "2026-07-28T12:00:00.000Z", {
          category: "travel",
          amount: 0,
          taken: false,
          notes: null,
        }),
      ]
    );

    expect(suggestion).toMatchObject({
      rowId: "r_new",
      values: [
        { fieldId: "amount", label: "Amount", value: 0 },
        { fieldId: "taken", label: "Taken", value: false },
      ],
    });
  });

  it("falls back cleanly when match values are absent, different, or have no copyable value", () => {
    const rows = [
      row("r_one", "2026-07-28T12:00:00.000Z", {
        category: "reading",
        amount: null,
        taken: false,
        notes: null,
      }),
    ];

    expect(findLogHistorySuggestion(definition, schema, {}, rows)).toBeNull();
    expect(findLogHistorySuggestion(definition, schema, { category: "habit" }, rows)).toBeNull();
    expect(findLogHistorySuggestion(
      { matchFields: ["category"], copyFields: ["notes"] },
      schema,
      { category: "reading" },
      rows
    )).toBeNull();
  });

  it("does not mutate manual edits until an explicit field or all-values copy", () => {
    const draft = {
      category: "medication",
      amount: 5,
      taken: false,
      notes: "Keep my manual note",
    };
    const rows = [
      row("r_prior", "2026-07-28T12:00:00.000Z", {
        category: "medication",
        amount: 10,
        taken: true,
        notes: "Prior note",
      }),
    ];

    const suggestion = findLogHistorySuggestion(definition, schema, draft, rows);
    expect(suggestion).not.toBeNull();
    expect(draft).toEqual({
      category: "medication",
      amount: 5,
      taken: false,
      notes: "Keep my manual note",
    });

    const copiedAmount = applyLogHistorySuggestion(draft, suggestion!, ["amount"]);
    expect(copiedAmount).toEqual({
      category: "medication",
      amount: 10,
      taken: false,
      notes: "Keep my manual note",
    });
    expect(applyLogHistorySuggestion(draft, suggestion!)).toEqual({
      category: "medication",
      amount: 10,
      taken: true,
      notes: "Prior note",
    });
  });

  it("excludes attachments and ephemeral dates unless their exact fields are opted in", () => {
    const prior = row("r_prior", "2026-07-28T12:00:00.000Z", {
      category: "reading",
      amount: 42,
      taken: true,
      notes: "Stable",
      proof: "/vault/Notebook/Reading.assets/proof.png",
      loggedOn: "2026-07-28",
    });

    const ordinary = findLogHistorySuggestion(
      definition,
      schema,
      { category: "reading" },
      [prior]
    );
    expect(ordinary?.values.map((item) => item.fieldId)).toEqual([
      "amount",
      "taken",
      "notes",
    ]);

    const optedIn = findLogHistorySuggestion(
      { matchFields: ["category"], copyFields: ["proof", "loggedOn"] },
      schema,
      { category: "reading" },
      [prior]
    );
    expect(optedIn?.values.map((item) => item.fieldId)).toEqual(["proof", "loggedOn"]);
  });
});
