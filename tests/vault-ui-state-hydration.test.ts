import {
  filterPersistedPaths,
  hasPersistedExpandState,
  resolveClosedNotebooksFromVaultState,
} from "@/lib/vault-ui-state-hydration";

describe("vault UI state hydration helpers", () => {
  it("treats empty expand arrays as valid persisted collapse state", () => {
    expect(hasPersistedExpandState({ expandedNotebooks: [], expandedSections: [] })).toBe(true);
    expect(hasPersistedExpandState({ expandedNotebooks: [] })).toBe(true);
    expect(hasPersistedExpandState({ expandedSections: [] })).toBe(true);
    expect(hasPersistedExpandState(null)).toBe(false);
    expect(hasPersistedExpandState({})).toBe(false);
  });

  it("distinguishes absent closedNotebooks from an empty array", () => {
    const localFallback = new Set(["Notebook A"]);

    expect(
      resolveClosedNotebooksFromVaultState({ closedNotebooks: [] }, localFallback)
    ).toEqual(new Set());

    expect(resolveClosedNotebooksFromVaultState({}, localFallback)).toEqual(localFallback);
    expect(resolveClosedNotebooksFromVaultState(null, localFallback)).toEqual(localFallback);
  });

  it("filters persisted paths against the current tree", () => {
    const validPaths = new Set(["Notebook A", "Notebook A/Section 1"]);

    expect(
      filterPersistedPaths(
        ["Notebook A", "Notebook A/Section 1", "Notebook B"],
        validPaths
      )
    ).toEqual(new Set(["Notebook A", "Notebook A/Section 1"]));

    expect(filterPersistedPaths([], validPaths)).toEqual(new Set());
  });
});
