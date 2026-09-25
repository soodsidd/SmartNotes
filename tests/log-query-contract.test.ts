import {
  LOG_QUERY_DEFAULT_LIMIT,
  LOG_QUERY_MAX_LIMIT,
  executeLogQuery,
  parseLogQuery,
} from "@/lib/log-query-contract";
import type { LogDocument } from "@/lib/log-contract";

function document(rowCount = 6): LogDocument {
  return {
    version: 1,
    schema: {
      fields: [
        { id: "kind", name: "Kind", type: "text" },
        { id: "amount", name: "Amount", type: "number" },
        { id: "day", name: "Day", type: "date" },
      ],
    },
    rows: Array.from({ length: rowCount }, (_, index) => ({
      id: `r_${index}`,
      createdAt: new Date(Date.UTC(2026, 6, index + 1)).toISOString(),
      values: {
        kind: index % 2 ? "run" : "ride",
        amount: index + 1,
        day: `2026-07-${String(index + 1).padStart(2, "0")}`,
      },
    })),
  };
}

describe("bounded log query contract (SN-147)", () => {
  it("filters, sorts, selects fields, applies a date range, and computes every aggregate", () => {
    const result = executeLogQuery(document(), {
      fields: ["kind", "amount"],
      filters: [{ field: "kind", operator: "eq", value: "run" }],
      dateRange: { from: "2026-07-01", to: "2026-07-06T23:59:59Z" },
      sort: [{ field: "amount", direction: "desc" }],
      limit: 2,
      aggregates: [
        { operator: "count", as: "entries" },
        { operator: "sum", field: "amount" },
        { operator: "average", field: "amount" },
        { operator: "minimum", field: "amount" },
        { operator: "maximum", field: "amount" },
      ],
    });

    expect(result.rows.map((row) => row.values.amount)).toEqual([6, 4]);
    expect(result.matchedCount).toBe(3);
    expect(result.truncated).toBe(true);
    expect(result.aggregates).toEqual({
      entries: 3,
      sum_amount: 12,
      average_amount: 4,
      minimum_amount: 2,
      maximum_amount: 6,
    });
  });

  it("uses a safe default and clamps requested results to the hard maximum", () => {
    expect(parseLogQuery({}, document().schema.fields).limit).toBe(LOG_QUERY_DEFAULT_LIMIT);
    expect(parseLogQuery({ limit: 99_999 }, document().schema.fields).limit).toBe(LOG_QUERY_MAX_LIMIT);
    expect(executeLogQuery(document(250), { limit: 99_999 }).rows).toHaveLength(LOG_QUERY_MAX_LIMIT);
  });

  it("rejects unknown fields, operators, SQL-like keys, and executable view keys", () => {
    expect(() => parseLogQuery({ fields: ["secret"] }, document().schema.fields)).toThrow(/unknown field/i);
    expect(() => parseLogQuery({
      filters: [{ field: "kind", operator: "regex", value: ".*" }],
    }, document().schema.fields)).toThrow(/allowlisted/i);
    expect(() => parseLogQuery({ sql: "select * from rows" }, document().schema.fields)).toThrow(/unsupported key/i);
    expect(() => parseLogQuery({ render: "<script>alert(1)</script>" }, document().schema.fields)).toThrow(/unsupported key/i);
  });

  it("bounds grouped aggregate output", () => {
    const result = executeLogQuery(document(250), {
      fields: ["kind"],
      groupBy: ["kind"],
      aggregates: [{ operator: "count" }, { operator: "sum", field: "amount" }],
      limit: 1,
    });
    expect(result.rows).toHaveLength(1);
    expect(result.groups).toHaveLength(2);
    expect(result.groups[0].aggregates).toHaveProperty("count");
  });
});
