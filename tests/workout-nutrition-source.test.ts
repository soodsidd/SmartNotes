import fs from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";

const source = fs.readFileSync(path.resolve("packages/workout-nutrition-app/app/source.html"), "utf8");

describe("Workout & Nutrition maintained App source", () => {
  it("uses the SN-182 bridge and host-owned durable acceptance", () => {
    expect(source).toContain("smartNotesApp.query('entries'");
    expect(source).toContain("smartNotesApp.query('config'");
    expect(source).toContain("smartNotesApp.accept('entries'");
    expect(source).not.toContain("localStorage");
    expect(source).not.toContain("fetch(");
  });

  it("provides everyday navigation, mobile set grid, copy/actions, timers, history, and progress", () => {
    for (const label of ["Workout", "Nutrition", "History", "Progress", "Use last session", "Copy complete workout", "Mark set complete", "Plate calculator", "W 00:00", "R 00:00"]) {
      expect(source).toContain(label);
    }
    expect(source).toContain("inputmode=\"decimal\"");
    expect(source).toContain("@media(max-width:640px)");
    expect(source).toContain("min-height:44px");
    expect(source).toContain("font-size:16px");
    expect(source).toContain("set-row");
    expect(source).toContain("Session options");
    expect(source).not.toContain("session-dock");
    expect(source).not.toContain("--dock-h");
  });

  it("executes schema-derived workout and nested nutrition UI against redacted App tables", async () => {
    const domain = fs.readFileSync(path.resolve("packages/workout-nutrition-app/app/domain.js"), "utf8");
    const document = source.replace("/*__WORKOUT_DOMAIN__*/", domain);
    const form = JSON.parse(fs.readFileSync(path.resolve("tests/fixtures/sn-183-redacted-workout-log/Health/Strength/workout-log.form.json"), "utf8"));
    const log = JSON.parse(fs.readFileSync(path.resolve("tests/fixtures/sn-183-redacted-workout-log/Health/Strength/workout-log.log.json"), "utf8"));
    const accepted: unknown[] = [];
    const dom = new JSDOM(document, {
      runScripts: "dangerously",
      beforeParse(window) {
        Object.defineProperty(window, "smartNotesApp", { value: {
          query: async (table: string) => table === "entries"
            ? { table: { id: "entries", schema: log.schema }, rows: log.rows }
            : { table: { id: "config" }, rows: [{ values: { form_definition: form } }] },
          accept: async (_table: string, values: unknown) => { accepted.push(values); return { pending: true }; },
        } });
      },
    });
    try {
    await new Promise((resolve) => setTimeout(resolve, 20));
    const window = dom.window;
    expect(window.document.querySelectorAll('[role="tab"]')).toHaveLength(4);
    (window.document.querySelector('[data-tab="nutrition"]') as HTMLButtonElement).click();
    expect(window.document.querySelector('input[data-general][type="text"]')).not.toBeNull();
    expect(window.document.body.textContent).toContain("Nutrition");
    expect([...(window.document.querySelector('#general-type') as HTMLSelectElement).options].map((option) => option.value)).toEqual(["Nutrition", "General activity"]);
    expect((window.document.querySelector('#general-type') as HTMLSelectElement).textContent).not.toContain("Strength session");
    (window.document.querySelector('[data-tab="workout"]') as HTMLButtonElement).click();
    const select = window.document.querySelector('#workout-select') as HTMLSelectElement;
    select.value = "A";
    select.dispatchEvent(new window.Event("change", { bubbles: true }));
    expect(window.document.querySelectorAll('[data-set-field]').length).toBeGreaterThan(0);
    expect(window.document.body.textContent).toContain("Exercise Alpha");
    expect(window.document.querySelector('#energy')?.tagName).toBe("SELECT");
    expect(window.document.querySelector('[data-plates]')).toBeNull();
    expect([...window.document.querySelectorAll('.previous button')].map((button) => button.textContent)).toEqual(expect.arrayContaining(["Wt", "Reps", "Set"]));
    expect(window.document.querySelector('.previous-actions')?.querySelectorAll('button')).toHaveLength(3);
    expect(source).toContain('grid-template-columns:repeat(2,minmax(0,1fr))');
    expect(source).toContain('grid-template-areas:"meta meta done"');
    const firstRowInputs = [...window.document.querySelectorAll('[data-set="0"][data-set-field]')];
    expect(firstRowInputs.map((node) => (node as HTMLElement).dataset.setField)).toEqual(["weight", "reps"]);
    const firstWeight = firstRowInputs[0] as HTMLInputElement;
    const firstReps = firstRowInputs[1] as HTMLInputElement;
    firstWeight.focus();
    firstWeight.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(window.document.activeElement).toBe(firstReps);
    const focusFirst = window.document.querySelector('[data-focus-first="true"]') as HTMLInputElement;
    expect(focusFirst).not.toBeNull();
    const pairedWeight = window.document.querySelector(`[data-exercise="${focusFirst.dataset.exercise}"][data-set="${focusFirst.dataset.set}"][data-set-field="weight"]`) as HTMLInputElement;
    focusFirst.focus();
    focusFirst.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(window.document.activeElement).toBe(pairedWeight);
    (window.document.querySelector('[data-complete="0:2"]') as HTMLButtonElement).click();
    const timedAfterComplete = window.document.querySelector('[data-exercise="0"][data-set="3"][data-set-field="seconds"]') as HTMLInputElement;
    expect(window.document.activeElement).toBe(timedAfterComplete);
    expect(accepted).toHaveLength(0);
    (window.document.querySelector('#use-last') as HTMLButtonElement).click();
    for (const input of [...window.document.querySelectorAll('[data-set-field]')] as HTMLInputElement[]) {
      input.value = "";
      input.dispatchEvent(new window.Event("input", { bubbles: true }));
    }
    (window.document.querySelector('#accept-workout') as HTMLButtonElement).click();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(window.document.querySelector('#validation')?.textContent).toContain("requires");
    expect(accepted).toHaveLength(0);

    (window.document.querySelector('[data-tab="nutrition"]') as HTMLButtonElement).click();
    const generalInput = (pathValue: string) => [...window.document.querySelectorAll('[data-general]')].find((node) => {
      const encoded = (node as HTMLElement).dataset.general;
      return encoded && JSON.parse(decodeURIComponent(encoded)).join(".") === pathValue;
    }) as HTMLInputElement;
    generalInput("sessionDate").value = "2026-08-04";
    generalInput("sessionDate").dispatchEvent(new window.Event("input", { bubbles: true }));
    generalInput("nutritionMovement.meal").value = "Redacted meal";
    generalInput("nutritionMovement.meal").dispatchEvent(new window.Event("input", { bubbles: true }));
    (window.document.querySelector('#accept-general') as HTMLButtonElement).click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const nutritionPayload = accepted[0] as Record<string, unknown>;
    expect(nutritionPayload.entryType).toBe("Nutrition");
    expect(nutritionPayload.workoutType).toBeUndefined();
    const companionDomain = (window as unknown as { WorkoutDomain: typeof import("../packages/workout-nutrition-app/app/domain.js") }).WorkoutDomain;
    expect(companionDomain.legacyToView(nutritionPayload, companionDomain.deriveLegacyAdapter(form))).toEqual(expect.objectContaining({ workout: null, exercises: [] }));

    (window.document.querySelector('[data-tab="workout"]') as HTMLButtonElement).click();
    const workoutSelect = window.document.querySelector('#workout-select') as HTMLSelectElement;
    workoutSelect.value = "A";
    workoutSelect.dispatchEvent(new window.Event("change", { bubbles: true }));
    (window.document.querySelector('#session-date') as HTMLInputElement).value = "2026-08-04";
    window.document.querySelector('#session-date')?.dispatchEvent(new window.Event("input", { bubbles: true }));
    const duration = window.document.querySelector('#duration') as HTMLInputElement;
    duration.value = "35";
    duration.dispatchEvent(new window.Event("input", { bubbles: true }));
    for (const input of [...window.document.querySelectorAll('[data-set-field]')] as HTMLInputElement[]) {
      input.value = input.dataset.setField === "weight" ? "50" : input.dataset.setField === "seconds" ? "45" : "8";
      input.dispatchEvent(new window.Event("input", { bubbles: true }));
    }
    const workingWeight = window.document.querySelector('[data-set="1"][data-set-field="weight"]') as HTMLInputElement;
    workingWeight.value = "-1";
    workingWeight.dispatchEvent(new window.Event("input", { bubbles: true }));
    (window.document.querySelector('#accept-workout') as HTMLButtonElement).click();
    expect(window.document.querySelector('#validation')?.textContent).toContain("cannot be negative");
    expect(accepted).toHaveLength(1);
    workingWeight.value = "50";
    workingWeight.dispatchEvent(new window.Event("input", { bubbles: true }));
    const workingReps = window.document.querySelector('[data-set="1"][data-set-field="reps"]') as HTMLInputElement;
    workingReps.value = "99";
    workingReps.dispatchEvent(new window.Event("input", { bubbles: true }));
    (window.document.querySelector('#accept-workout') as HTMLButtonElement).click();
    expect(window.document.querySelector('#validation')?.textContent).toContain("at most 12");
    expect(accepted).toHaveLength(1);
    workingReps.value = "8";
    workingReps.dispatchEvent(new window.Event("input", { bubbles: true }));
    const timedSeconds = window.document.querySelector('[data-set-field="seconds"]') as HTMLInputElement;
    timedSeconds.value = "301";
    timedSeconds.dispatchEvent(new window.Event("input", { bubbles: true }));
    duration.value = "301";
    duration.dispatchEvent(new window.Event("input", { bubbles: true }));
    (window.document.querySelector('#accept-workout') as HTMLButtonElement).click();
    expect(window.document.querySelector('#validation')?.textContent).toContain("at most 300");
    expect(accepted).toHaveLength(1);
    timedSeconds.value = "45";
    timedSeconds.dispatchEvent(new window.Event("input", { bubbles: true }));
    duration.value = "35";
    duration.dispatchEvent(new window.Event("input", { bubbles: true }));
    (window.document.querySelector('#accept-workout') as HTMLButtonElement).click();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect((accepted[1] as Record<string, unknown>).entryType).toBe("Strength session");
    (window.document.querySelector('[data-tab="progress"]') as HTMLButtonElement).click();
    expect(window.document.querySelector('#progress')?.textContent).toContain("Load PR");
    expect(window.document.querySelector('#progress')?.textContent).toContain("Rep PR");
    expect(window.document.querySelector('#progress')?.textContent).toContain("recent volume");
    expect(window.document.querySelectorAll('#progress .pr-line').length).toBeGreaterThanOrEqual(2);
    expect(source).toContain("min-width:44px");
    expect(source).toContain("logicalInputs");
    } finally {
      dom.window.close();
    }
  });

  it("uses only documented Clarity color, spacing, typography, border, and radius tokens", () => {
    for (const token of ["--background", "--foreground", "--surface", "--accent", "--muted-foreground", "--border", "--input", "--radius-sm", "--font-sans"]) {
      expect(source).toContain(`var(${token})`);
    }
    const documentedHex = new Set(["#f6f6f4", "#0d0d0d", "#fbfbf9", "#ffffff", "#ececf0", "#4d4d57", "#f2f2f4", "#8e8ea0", "#dedee4", "#1e1e1e", "#ececec", "#2a2a2a", "#b4b4b4", "#171717", "#8a8a90", "#333333"]);
    const styles = source.slice(0, source.indexOf("</style>"));
    expect([...styles.matchAll(/#[0-9a-f]{3,8}/gi)].every((match) => documentedHex.has(match[0].toLowerCase()))).toBe(true);
    const documentedSpacing = new Set([0, 4, 8, 12, 16, 20, 24, 32, 40, 56]);
    const spacingDeclarations = [...styles.matchAll(/(?:^|[;{])(?:gap|row-gap|column-gap|padding(?:-(?:top|right|bottom|left))?|margin(?:-(?:top|right|bottom|left))?|outline-offset):([^;}]+)/gm)];
    const spacingValues = spacingDeclarations.flatMap((match) => [...match[1].matchAll(/(-?\d+(?:\.\d+)?)px/g)].map((value) => Number(value[1])));
    expect(spacingValues.every((value) => documentedSpacing.has(value))).toBe(true);
    const documentedTypeSizes = new Set([10, 11, 12, 13, 16, 20, 22, 26, 34]);
    const fontSizes = [...styles.matchAll(/font-size:(\d+(?:\.\d+)?)px/g)].map((match) => Number(match[1]));
    expect(fontSizes.every((value) => documentedTypeSizes.has(value))).toBe(true);
    const documentedLineHeights = new Set([1.15, 1.2, 1.3, 1.4, 1.45, 1.6, 1.72]);
    const lineHeights = [...styles.matchAll(/line-height:(\d+(?:\.\d+)?)/g)].map((match) => Number(match[1]));
    expect(lineHeights.every((value) => documentedLineHeights.has(value))).toBe(true);
  });
});
