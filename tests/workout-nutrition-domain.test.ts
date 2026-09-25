// The companion package is plain JS so the exact logic can run unchanged inside the opaque App iframe.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const domain = require("../packages/workout-nutrition-app/app/domain.js");

const history = [{
  id: "r_redacted01", createdAt: "2026-01-01T12:00:00.000Z", values: {
    date: "2026-01-01", exercises: [{ id: "exercise-alpha", label: "Exercise Alpha", equipment: "barbell", sets: [
      { kind: "working", number: 1, weight: 100, reps: 8 }, { kind: "working", number: 2, weight: 105, reps: 8 },
    ] }],
  },
}];

describe("Workout & Nutrition companion domain", () => {
  it("suggests without committing date, weekday workout, and duration", () => {
    expect(domain.suggestDefaults(new Date(2026, 0, 5, 12))).toEqual({ date: "2026-01-05", workout: "A", duration: 35 });
    expect(domain.suggestDefaults(new Date(2026, 0, 10, 12)).workout).toBeNull();
  });

  it("matches nested prior sets and copies field/set/exercise/workout immutably", () => {
    expect(domain.findPreviousSet(history, { id: "exercise-alpha" }, 2).set).toEqual({ kind: "working", number: 2, weight: 105, reps: 8 });
    const draft = { exercises: [{ sets: [{ weight: 80, reps: 6 }, { weight: 80, reps: 6 }] }] };
    const previous = { exercises: [{ sets: [{ weight: 100, reps: 8 }, { weight: 105, reps: 8 }] }] };
    expect(domain.copyScope(draft, previous, { kind: "field", exerciseIndex: 0, setIndex: 0, field: "weight" }).exercises[0].sets[0]).toEqual({ weight: 100, reps: 6 });
    expect(domain.copyScope(draft, previous, { kind: "set", exerciseIndex: 0, setIndex: 1 }).exercises[0].sets[1]).toEqual({ weight: 105, reps: 8 });
    expect(domain.copyScope(draft, previous, { kind: "exercise", exerciseIndex: 0 }).exercises[0].sets).toEqual(previous.exercises[0].sets);
    expect(domain.copyScope(draft, previous, { kind: "workout" }).exercises).toEqual(previous.exercises);
    expect(draft.exercises[0].sets[0].weight).toBe(80);
    const correctedOlder = { ...history[0], updatedAt: "2026-12-31T12:00:00.000Z" };
    const newer = { id: "r_redacted02", createdAt: "2026-02-01T12:00:00.000Z", values: { date: "2026-02-01", exercises: [{ id: "exercise-alpha", sets: [{ weight: 120, reps: 6 }] }] } };
    expect(domain.findPreviousSet([correctedOlder, newer], { id: "exercise-alpha" }, 1).set.weight).toBe(120);
  });

  it("proposes working loads, practical warm-ups, and plates with equipment semantics", () => {
    expect(domain.proposeWorkingLoad(history, { id: "exercise-alpha" })).toBe(105);
    const mixedLoads = [{ ...history[0], values: { ...history[0].values, exercises: [{ ...history[0].values.exercises[0], sets: [
      { kind: "warmup", number: 1, weight: 200, reps: 2 },
      { kind: "working", number: 1, weight: 100, reps: 8 },
    ] }] } }];
    expect(domain.proposeWorkingLoad(mixedLoads, { id: "exercise-alpha" })).toBe(100);
    expect(domain.warmupLoads(200, "barbell")).toEqual([50, 100]);
    expect(domain.warmupLoads(100, "barbell")).toEqual([45, 50]);
    expect(domain.warmupLoads(40, "dumbbell")).toEqual([10, 20]);
    expect(domain.warmupLoads(100, "unknown")).toEqual([]);
    expect(domain.proposeWorkingLoad(history, { id: "exercise-alpha", equipment: "unknown" })).toBeNull();
    expect(domain.plateCalculator(135)).toEqual({ valid: true, perSide: [{ plate: 45, count: 1 }], remainder: 0 });
    expect(domain.equipment("dumbbell").label).toBe("per dumbbell");
    expect(domain.equipment("added_weight").label).toBe("added weight");
  });

  it("validates normal, time-crunch, and pain-stopped workouts", () => {
    const prescription = { exercises: [{ id: "exercise-alpha", label: "Exercise Alpha", setCount: 3 }] };
    const base = { entryType: "workout", date: "2026-01-01", workout: "A", exercises: [{ id: "exercise-alpha", sets: [{ kind: "working", reps: 8 }] }] };
    expect(domain.validateWorkout(base, prescription)).toContain("Exercise Alpha requires 3 sets.");
    expect(domain.validateWorkout({ ...base, timeCrunch: true }, prescription)).toEqual([]);
    expect(domain.validateWorkout({ ...base, painStopped: true }, prescription)).toContain("Add a note for a pain-stopped session.");
    expect(domain.validateWorkout({ ...base, painStopped: true, notes: "Stopped safely" }, prescription)).toEqual([]);
    const timed = { ...base, entryType: "Strength session", exercises: [{ id: "exercise-alpha", sets: [{ kind: "working", seconds: 45 }, { kind: "working", seconds: 45 }, { kind: "working", seconds: 45 }] }] };
    expect(domain.validateWorkout(timed, prescription)).toEqual([]);
    const invalidNegative = { ...base, exercises: [{ id: "exercise-alpha", sets: [{ kind: "working", completed: true, reps: -1 }] }] };
    expect(domain.validateWorkout(invalidNegative, { exercises: [{ id: "exercise-alpha", label: "Exercise Alpha", setCount: 1 }] })).toContain("Exercise Alpha requires 1 sets.");
    const partialWorking = { ...base, exercises: [{ id: "exercise-alpha", sets: [
      { kind: "warmup", completed: true, reps: 10 },
      { kind: "working", completed: true, reps: 8 },
    ] }] };
    expect(domain.validateWorkout(partialWorking, { exercises: [{ id: "exercise-alpha", label: "Exercise Alpha", setCount: 2 }] })).toContain("Exercise Alpha requires 2 sets.");
  });

  it("recognizes progression, trends, PRs, timers, and logical set focus", () => {
    const prescription = { equipment: "barbell", sets: [
      { kind: "warmup", number: 1, measure: "reps", repMax: 10 },
      { kind: "working", number: 1, measure: "reps", repMax: 8 },
      { kind: "working", number: 2, measure: "reps", repMax: 8 },
      { kind: "working", number: 3, measure: "seconds", target: { max: 60 } },
    ] };
    const mixed = { equipment: "barbell", sets: [
      { kind: "warmup", number: 1, weight: 45, reps: 1 },
      { kind: "working", number: 1, weight: 100, reps: 8 },
      { kind: "working", number: 2, weight: 105, reps: 8 },
      { kind: "working", number: 3, seconds: 45 },
    ] };
    expect(domain.progressionSuggestion(mixed, prescription).load).toBe(110);
    expect(domain.progressionSuggestion({ ...mixed, sets: mixed.sets.map((set, index) => index === 2 ? { ...set, reps: 7 } : set) }, prescription)).toBeNull();
    expect(domain.progressionSuggestion({ ...mixed, equipment: "unknown" }, prescription)).toBeNull();
    expect(domain.exerciseTrend(history, { id: "exercise-alpha" })).toEqual([{ rowId: "r_redacted01", date: "2026-01-01", metric: "volume", value: 840, unit: "load×reps" }]);
    const measureRows = [{ id: "r_measures", createdAt: "2026-01-02", values: { date: "2026-01-02", exercises: [
      { id: "body", equipment: "bodyweight", sets: [{ kind: "working", reps: 14 }] },
      { id: "timed", equipment: "cable", sets: [{ kind: "working", seconds: 75 }] },
    ] } }];
    expect(domain.exerciseTrend(measureRows, { id: "body" })[0]).toEqual(expect.objectContaining({ metric: "reps", value: 14, unit: "reps" }));
    expect(domain.exerciseTrend(measureRows, { id: "timed" })[0]).toEqual(expect.objectContaining({ metric: "duration", value: 75, unit: "sec" }));
    const records = domain.personalRecords([{ ...history[0], values: { ...history[0].values, exercises: [{ ...history[0].values.exercises[0], sets: [
      ...history[0].values.exercises[0].sets,
      { kind: "working", number: 3, weight: 80, reps: 12 },
      { kind: "working", number: 4, seconds: 75 },
    ] }] } }])["exercise-alpha"];
    expect(records).toEqual(expect.objectContaining({
      semantics: "total barbell",
      load: { value: 105, reps: 8, rowId: "r_redacted01" },
      reps: { value: 12, load: 80, rowId: "r_redacted01" },
      duration: { seconds: 75, rowId: "r_redacted01" },
    }));
    expect(domain.timerReducer(domain.timerReducer(undefined, "start", 1000), "pause", 3500)).toEqual({ elapsedMs: 2500, runningSince: null });
    const completed = domain.completeSet({ exercises: [{ sets: [{}, {}] }] }, 0, 0);
    expect(completed.draft.exercises[0].sets[0].completed).toBe(true);
    expect(completed.focus).toEqual({ exerciseIndex: 0, setIndex: 1, field: "weight" });
  });

  it("round-trips legacy workoutA-E nested rows without dropping unrelated keys", () => {
    const form = { schema: { properties: {
      sessionDate: { type: "string" }, entryType: { type: "string" }, workoutType: { type: "string" }, notes: { type: "string" },
      stoppedDueToPain: { type: "boolean" }, workoutA: { title: "Workout A", type: "object", properties: {
        alpha: { title: "Exercise Alpha", description: "Load is per dumbbell", type: "object", properties: {
          prepWeightLb: { type: "number" }, prepReps: { type: "number" }, warmup1WeightLb: { type: "number" }, warmup1Reps: { type: "number" },
          set1WeightLb: { type: "number" }, set1Reps: { type: "number", minimum: 6, maximum: 8 }, set2WeightLb: { type: "number" }, set2Reps: { type: "number" }, set3Seconds: { type: "number", minimum: 30, maximum: 60 }, privateUnrelated: { type: "string" },
        } },
      } },
    } } };
    const original = { sessionDate: "2026-01-05", entryType: "Strength session", workoutType: "A", notes: "redacted", stoppedDueToPain: true, topUnrelated: { keep: true }, workoutA: { alpha: {
      prepWeightLb: 20, prepReps: 10, warmup1WeightLb: 30, warmup1Reps: 8,
      set1WeightLb: 50, set1Reps: 8, set2WeightLb: 55, set2Reps: 7, set3Seconds: 45, privateUnrelated: "preserved",
    } } };
    const adapter = domain.deriveLegacyAdapter(form);
    const view = domain.legacyToView(original, adapter);
    expect(domain.legacyToView({ ...original, entryType: "Nutrition" }, adapter)).toEqual(expect.objectContaining({ workout: null, exercises: [] }));
    expect(view.painStopped).toBe(true);
    expect(view.exercises[0]).toEqual(expect.objectContaining({ label: "Exercise Alpha", equipment: "dumbbell", sets: [
      { number: 1, kind: "prep", weight: 20, reps: 10, seconds: null },
      { number: 1, kind: "warmup", weight: 30, reps: 8, seconds: null },
      { number: 1, kind: "working", target: { min: 6, max: 8, label: null }, weight: 50, reps: 8, seconds: null },
      { number: 2, kind: "working", weight: 55, reps: 7, seconds: null },
      { number: 3, kind: "working", target: { min: 30, max: 60, label: null }, weight: null, reps: null, seconds: 45 },
    ] }));
    view.exercises[0].sets[3].reps = 8;
    view.exercises[0].sets[4].seconds = 60;
    const serialized = domain.viewToLegacy(view, original, adapter);
    expect(serialized.workoutA.alpha.set2Reps).toBe(8);
    expect(serialized.workoutA.alpha.set3Seconds).toBe(60);
    expect(serialized.workoutA.alpha.privateUnrelated).toBe("preserved");
    expect(serialized.topUnrelated).toEqual({ keep: true });
    expect(original.workoutA.alpha.set2Reps).toBe(7);
  });

  it("fails visibly when equipment semantics cannot be derived", () => {
    expect(domain.inferEquipment({ title: "Exercise Omega" }, "omega")).toBe("unknown");
    expect(domain.equipment("unknown").label).toMatch(/needs configuration/);
  });
});
