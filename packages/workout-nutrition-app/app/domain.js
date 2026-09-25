(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.WorkoutDomain = api;
})(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";

  const EQUIPMENT = Object.freeze({
    barbell: { label: "total barbell", increment: 5, minimum: 45 },
    dumbbell: { label: "per dumbbell", increment: 5, minimum: 0 },
    cable: { label: "cable stack", increment: 5, minimum: 0 },
    bodyweight: { label: "bodyweight", increment: 0, minimum: 0 },
    added_weight: { label: "added weight", increment: 2.5, minimum: 0 },
    unknown: { label: "equipment meaning needs configuration", increment: 0, minimum: 0 },
  });

  function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  function finite(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function equipment(type) {
    return EQUIPMENT[type] || EQUIPMENT.unknown;
  }

  function roundToIncrement(value, increment) {
    const number = finite(value);
    const step = finite(increment);
    if (number === null) return null;
    if (!step || step <= 0) return number;
    return Math.round(number / step) * step;
  }

  function suggestDefaults(now) {
    const date = now instanceof Date ? now : new Date(now || Date.now());
    const weekday = date.getDay();
    const workout = weekday >= 1 && weekday <= 5 ? String.fromCharCode(64 + weekday) : null;
    return {
      date: [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-"),
      workout,
      duration: 35,
    };
  }

  function warmupLoads(workingLoad, equipmentType, incrementOverride) {
    const definition = equipment(equipmentType);
    const working = finite(workingLoad);
    if (working === null || working <= 0 || definition === EQUIPMENT.bodyweight || definition === EQUIPMENT.unknown) return [];
    const increment = finite(incrementOverride) || definition.increment || 1;
    const minimum = equipmentType === "barbell" ? 45 : definition.minimum;
    return [0.25, 0.5].map((ratio) => Math.max(minimum, roundToIncrement(working * ratio, increment)));
  }

  function plateCalculator(totalLoad, options) {
    const settings = options || {};
    const bar = finite(settings.barWeight) ?? 45;
    const total = finite(totalLoad);
    const available = (settings.plates || [45, 35, 25, 10, 5, 2.5])
      .map(finite).filter((value) => value && value > 0).sort((a, b) => b - a);
    if (total === null || total < bar) return { valid: false, perSide: [], remainder: null };
    let remaining = (total - bar) / 2;
    const perSide = [];
    for (const plate of available) {
      const count = Math.floor((remaining + 1e-9) / plate);
      if (count > 0) {
        perSide.push({ plate, count });
        remaining -= count * plate;
      }
    }
    return { valid: Math.abs(remaining) < 0.001, perSide, remainder: Math.max(0, remaining) };
  }

  function sessionsNewestFirst(rows) {
    const sessionTime = (row) => String(row?.values?.date || row?.values?.sessionDate || row?.values?.details?.date || row?.createdAt || "");
    return (rows || []).slice().sort((left, right) => sessionTime(right).localeCompare(sessionTime(left)) ||
      String(right.createdAt || "").localeCompare(String(left.createdAt || "")));
  }

  function exerciseIdentity(exercise) {
    return String(exercise && (exercise.id || exercise.exerciseId || exercise.name || exercise.label) || "").trim().toLowerCase();
  }

  function findPreviousSet(rows, exercise, setNumber) {
    const identity = exerciseIdentity(exercise);
    for (const row of sessionsNewestFirst(rows)) {
      const exercises = row.values && (row.values.exercises || row.values.workoutDetails || row.values.details?.exercises) || [];
      const match = Array.isArray(exercises) ? exercises.find((candidate) => exerciseIdentity(candidate) === identity) : null;
      const set = match && Array.isArray(match.sets) ? match.sets[Number(setNumber) - 1] : null;
      if (set) return { rowId: row.id, createdAt: row.createdAt, set: clone(set) };
    }
    return null;
  }

  function copyScope(draft, previous, scope) {
    const next = clone(draft);
    if (!previous) return next;
    const targetExercise = next.exercises?.[scope.exerciseIndex];
    const sourceExercise = previous.exercises?.[scope.exerciseIndex];
    if (scope.kind === "workout") return { ...next, exercises: clone(previous.exercises || []) };
    if (!targetExercise || !sourceExercise) return next;
    if (scope.kind === "exercise") targetExercise.sets = clone(sourceExercise.sets || []);
    if (scope.kind === "set") targetExercise.sets[scope.setIndex] = clone(sourceExercise.sets?.[scope.setIndex] || {});
    if (scope.kind === "field") {
      targetExercise.sets[scope.setIndex][scope.field] = clone(sourceExercise.sets?.[scope.setIndex]?.[scope.field]);
    }
    return next;
  }

  function proposeWorkingLoad(rows, exercise, options) {
    const settings = options || {};
    if (exercise?.equipment && equipment(exercise.equipment) === EQUIPMENT.unknown) return null;
    const identity = exerciseIdentity(exercise);
    for (const row of sessionsNewestFirst(rows)) {
      const exercises = row.values && (row.values.exercises || row.values.workoutDetails || row.values.details?.exercises) || [];
      const match = Array.isArray(exercises) ? exercises.find((candidate) => exerciseIdentity(candidate) === identity) : null;
      if (!match || !Array.isArray(match.sets)) continue;
      if (equipment(match.equipment || exercise?.equipment) === EQUIPMENT.unknown) return null;
      const loads = match.sets
        .filter((set) => set?.kind === "working")
        .map((set) => finite(set.weight))
        .filter((value) => value !== null && value > 0);
      if (!loads.length) continue;
      return roundToIncrement(Math.max(...loads), settings.increment || equipment(match.equipment).increment);
    }
    return null;
  }

  function validateWorkout(entry, prescription) {
    const errors = [];
    if (!entry || !/workout|strength|lifting/i.test(String(entry.entryType))) return errors;
    if (!entry.date) errors.push("Date is required.");
    if (!entry.workout) errors.push("Workout A-E is required.");
    const required = prescription?.exercises || [];
    const actual = Array.isArray(entry.exercises) ? entry.exercises : [];
    for (const prescribed of required) {
      const exercise = actual.find((candidate) => exerciseIdentity(candidate) === exerciseIdentity(prescribed));
      if (!exercise) {
        if (!entry.painStopped) errors.push(`${prescribed.label || prescribed.name || "Exercise"} is required.`);
        continue;
      }
      const expected = Number(prescribed.setCount || prescribed.sets || 0);
      const completed = (exercise.sets || []).filter((set) => {
        if (!set || set.kind !== "working") return false;
        const measures = [finite(set.reps), finite(set.seconds)].filter((value) => value !== null);
        if (measures.some((value) => value < 0)) return false;
        return Boolean(set.completed) || measures.some((value) => value > 0);
      }).length;
      if (!entry.timeCrunch && !entry.painStopped && expected && completed < expected) {
        errors.push(`${prescribed.label || prescribed.name || "Exercise"} requires ${expected} sets.`);
      }
    }
    if (entry.painStopped && !String(entry.notes || "").trim()) errors.push("Add a note for a pain-stopped session.");
    return errors;
  }

  function progressionSuggestion(exercise, prescription) {
    if (!exercise || exercise.painStopped || !Array.isArray(exercise.sets) || !exercise.sets.length) return null;
    const prescribedRepSets = (prescription?.sets || []).filter((set) =>
      set?.kind === "working" && (set.measure === "reps" || set.paths?.reps)
    );
    if (!prescribedRepSets.length) return null;
    const actualWorkingSets = exercise.sets.filter((set) => set?.kind === "working");
    const completedRepSets = prescribedRepSets.map((prescribed, index) => {
      const actual = actualWorkingSets.find((set) => Number(set.number) === Number(prescribed.number)) || actualWorkingSets[index];
      const top = finite(prescribed.repMax ?? prescribed.target?.max);
      const reps = finite(actual?.reps);
      return top !== null && reps !== null && reps >= top ? actual : null;
    });
    if (completedRepSets.length !== prescribedRepSets.length || completedRepSets.some((set) => !set)) return null;
    const definition = equipment(exercise.equipment || prescription?.equipment);
    if (definition === EQUIPMENT.unknown) return null;
    if (!definition.increment) return { kind: "reps", message: "Rep range completed; progress the movement difficulty." };
    const load = Math.max(...completedRepSets.map((set) => finite(set.weight) || 0));
    return {
      kind: "load",
      load: roundToIncrement(load + definition.increment, definition.increment),
      semantics: definition.label,
      message: `Rep range completed; consider the next ${definition.label} increment.`,
    };
  }

  function personalRecords(rows) {
    const records = {};
    for (const row of rows || []) {
      const exercises = row.values && (row.values.exercises || row.values.workoutDetails || row.values.details?.exercises) || [];
      for (const exercise of Array.isArray(exercises) ? exercises : []) {
        const id = exerciseIdentity(exercise);
        if (!id) continue;
        const record = records[id] ||= {
          exercise: exercise.label || exercise.name || exercise.id,
          semantics: equipment(exercise.equipment).label,
          load: null,
          reps: null,
          duration: null,
        };
        for (const set of (exercise.sets || []).filter((candidate) => !candidate?.kind || candidate.kind === "working")) {
          const weight = finite(set.weight);
          const reps = finite(set.reps);
          const seconds = finite(set.seconds);
          if (weight !== null && weight > 0 && (!record.load || weight > record.load.value || (weight === record.load.value && (reps || 0) > (record.load.reps || 0)))) {
            record.load = { value: weight, reps: reps && reps > 0 ? reps : null, rowId: row.id };
          }
          if (reps !== null && reps > 0 && (!record.reps || reps > record.reps.value || (reps === record.reps.value && (weight || 0) > (record.reps.load || 0)))) {
            record.reps = { value: reps, load: weight && weight > 0 ? weight : null, rowId: row.id };
          }
          if (seconds !== null && seconds > 0 && (!record.duration || seconds > record.duration.seconds)) {
            record.duration = { seconds, rowId: row.id };
          }
        }
      }
    }
    for (const [id, record] of Object.entries(records)) {
      if (!record.load && !record.reps && !record.duration) delete records[id];
    }
    return records;
  }

  function exerciseTrend(rows, exercise) {
    const identity = exerciseIdentity(exercise);
    const points = [];
    for (const row of sessionsNewestFirst(rows).reverse()) {
      const exercises = row.values && (row.values.exercises || row.values.workoutDetails || row.values.details?.exercises) || [];
      const match = Array.isArray(exercises) ? exercises.find((candidate) => exerciseIdentity(candidate) === identity) : null;
      if (!match) continue;
      const sets = (match.sets || []).filter((set) => !set?.kind || set.kind === "working");
      const loadedVolume = Math.max(0, ...sets.map((set) => {
        const weight = finite(set.weight), reps = finite(set.reps);
        return weight !== null && weight > 0 && reps !== null && reps > 0 ? weight * reps : 0;
      }));
      const bestReps = Math.max(0, ...sets.map((set) => finite(set.reps) || 0));
      const bestSeconds = Math.max(0, ...sets.map((set) => finite(set.seconds) || 0));
      let metric = "volume", unit = "load×reps", value = loadedVolume;
      if (equipment(match.equipment) === EQUIPMENT.bodyweight) {
        metric = "reps"; unit = "reps"; value = bestReps;
      } else if (!loadedVolume && bestSeconds) {
        metric = "duration"; unit = "sec"; value = bestSeconds;
      } else if (!loadedVolume && bestReps) {
        metric = "reps"; unit = "reps"; value = bestReps;
      }
      if (value > 0) points.push({ rowId: row.id, date: row.values?.date || row.createdAt, metric, value, unit });
    }
    return points;
  }

  function timerReducer(state, action, now) {
    const current = { elapsedMs: 0, runningSince: null, ...(state || {}) };
    const timestamp = Number(now || Date.now());
    const elapsed = current.runningSince === null ? current.elapsedMs : current.elapsedMs + Math.max(0, timestamp - current.runningSince);
    if (action === "start") return current.runningSince === null ? { elapsedMs: current.elapsedMs, runningSince: timestamp } : current;
    if (action === "pause") return { elapsedMs: elapsed, runningSince: null };
    if (action === "reset") return { elapsedMs: 0, runningSince: null };
    return { elapsedMs: elapsed, runningSince: current.runningSince === null ? null : timestamp };
  }

  function completeSet(draft, exerciseIndex, setIndex) {
    const next = clone(draft);
    next.exercises[exerciseIndex].sets[setIndex].completed = true;
    const sameExerciseNext = next.exercises[exerciseIndex].sets[setIndex + 1];
    if (sameExerciseNext) return { draft: next, focus: { exerciseIndex, setIndex: setIndex + 1, field: "weight" } };
    const nextExercise = next.exercises[exerciseIndex + 1];
    return { draft: next, focus: nextExercise ? { exerciseIndex: exerciseIndex + 1, setIndex: 0, field: "weight" } : null };
  }

  function setAtPath(target, path, value) {
    let cursor = target;
    path.forEach((segment, index) => {
      if (index === path.length - 1) cursor[segment] = value;
      else cursor = cursor[segment] && typeof cursor[segment] === "object" ? cursor[segment] : (cursor[segment] = {});
    });
  }

  function getAtPath(target, path) {
    return path.reduce((cursor, segment) => cursor && cursor[segment], target);
  }

  function schemaLeaves(schema, path, output) {
    const properties = schema && schema.properties;
    if (!properties || typeof properties !== "object") return output;
    for (const [key, child] of Object.entries(properties)) {
      const nextPath = path.concat(key);
      if (child && child.properties) schemaLeaves(child, nextPath, output);
      else output.push({ path: nextPath, schema: child || {}, key });
    }
    return output;
  }

  function inferEquipment(schema, identity) {
    const explicit = String(schema?.["x-equipment"] || schema?.equipment || "").toLowerCase().replace(/[ -]+/g, "_");
    if (EQUIPMENT[explicit]) return explicit;
    const clue = `${identity || ""} ${schema?.title || ""} ${schema?.description || ""}`.toLowerCase();
    if (/added[ -]?weight|weighted body/.test(clue)) return "added_weight";
    if (/dumbbell|\bdb\b|per hand/.test(clue)) return "dumbbell";
    if (/cable|stack|pulldown/.test(clue)) return "cable";
    if (/body[ -]?weight|push[ -]?up|pull[ -]?up/.test(clue)) return "bodyweight";
    if (/barbell|\bbb\b|total bar/.test(clue)) return "barbell";
    return "unknown";
  }

  function deriveLegacyAdapter(formDefinition) {
    const schema = formDefinition?.schema || formDefinition || {};
    const workouts = {};
    for (const [key, workoutSchema] of Object.entries(schema.properties || {})) {
      const match = /^workout([a-e])$/i.exec(key);
      if (!match || !workoutSchema || typeof workoutSchema !== "object") continue;
      const leaves = schemaLeaves(workoutSchema, [key], []);
      const groups = new Map();
      for (const leaf of leaves) {
        const setMatch = /^(?:(warmup)(\d+)|(prep)|(set)(\d+))(weight(?:lb)?|reps|seconds)$/i.exec(leaf.key);
        if (!setMatch) continue;
        const exercisePath = leaf.path.slice(0, -1);
        const identity = exercisePath.join(".");
        if (!groups.has(identity)) {
          let cursor = workoutSchema;
          for (const segment of exercisePath.slice(1)) cursor = cursor?.properties?.[segment];
          groups.set(identity, {
            id: exercisePath[exercisePath.length - 1],
            label: cursor?.title || leaf.schema?.["x-exercise-label"] || `Exercise ${groups.size + 1}`,
            equipment: inferEquipment(cursor, exercisePath[exercisePath.length - 1]),
            path: exercisePath,
            sets: {},
          });
        }
        const group = groups.get(identity);
        const kind = setMatch[3] ? "prep" : setMatch[1] ? "warmup" : "working";
        const setNumber = setMatch[3] ? 1 : Number(setMatch[2] || setMatch[5]);
        const setKey = `${kind}:${setNumber}`;
        group.sets[setKey] ||= { kind, number: setNumber, paths: {} };
        const measure = setMatch[6].toLowerCase();
        const field = measure.startsWith("weight") ? "weight" : measure;
        group.sets[setKey].paths[field] = leaf.path;
        if (field === "reps" || field === "seconds") {
          const target = {
            min: finite(leaf.schema?.minimum), max: finite(leaf.schema?.maximum),
            label: leaf.schema?.description || leaf.schema?.title || null,
          };
          if (target.min !== null || target.max !== null || target.label) group.sets[setKey].target = target;
        }
      }
      workouts[match[1].toUpperCase()] = {
        key,
        label: workoutSchema.title || `Workout ${match[1].toUpperCase()}`,
        exercises: Array.from(groups.values()).map((group) => ({
          ...group,
          sets: Object.values(group.sets).sort((a, b) => {
            const rank = { prep: 0, warmup: 1, working: 2 };
            return rank[a.kind] - rank[b.kind] || a.number - b.number;
          }),
        })),
      };
    }
    const topLeaves = schemaLeaves(schema, [], []);
    const field = (patterns) => topLeaves.find((leaf) => leaf.path.length === 1 && patterns.some((pattern) => pattern.test(leaf.key)))?.path || null;
    return {
      workouts,
      fields: {
        date: field([/^date$/i, /sessiondate/i]), workout: field([/^workout$/i, /workouttype/i]),
        duration: field([/duration/i]), energy: field([/energy/i]), timeCrunch: field([/time.?crunch/i]),
        painStopped: field([/pain.?stopped/i, /stopped.*pain/i]), notes: field([/notes?$/i]), entryType: field([/entry.?type/i, /^type$/i]),
      },
    };
  }

  function legacyToView(values, adapter) {
    const source = values || {};
    const workoutField = adapter?.fields?.workout;
    const entryTypeField = adapter?.fields?.entryType;
    const rawEntryType = entryTypeField ? getAtPath(source, entryTypeField) : null;
    const workoutEntry = !rawEntryType || /workout|strength|lifting/i.test(String(rawEntryType));
    let selected = workoutEntry && workoutField ? String(getAtPath(source, workoutField) || "").replace(/^workout\s*/i, "").toUpperCase() : "";
    if (!selected && workoutEntry) {
      selected = Object.keys(adapter?.workouts || {}).find((key) => {
        const candidate = getAtPath(source, [adapter.workouts[key].key]);
        return candidate && typeof candidate === "object" && Object.keys(candidate).length > 0;
      }) || "";
    }
    const definition = adapter?.workouts?.[selected];
    const exercises = (definition?.exercises || []).map((exercise) => ({
      id: exercise.id, label: exercise.label, equipment: exercise.equipment,
      sets: exercise.sets.map((set) => ({
        number: set.number, kind: set.kind, ...(set.target ? { target: clone(set.target) } : {}),
        weight: set.paths.weight ? getAtPath(source, set.paths.weight) ?? null : null,
        reps: set.paths.reps ? getAtPath(source, set.paths.reps) ?? null : null,
        seconds: set.paths.seconds ? getAtPath(source, set.paths.seconds) ?? null : null,
      })),
    }));
    const read = (name) => adapter?.fields?.[name] ? getAtPath(source, adapter.fields[name]) : undefined;
    return {
      entryType: read("entryType") || (selected ? "workout" : "activity"), date: read("date") || null,
      workout: selected || null, duration: read("duration") ?? null, energy: read("energy") ?? null,
      timeCrunch: Boolean(read("timeCrunch")), painStopped: Boolean(read("painStopped")), notes: read("notes") || "",
      exercises,
    };
  }

  function viewToLegacy(view, originalValues, adapter) {
    const next = clone(originalValues || {});
    const writeField = (name, value) => { if (adapter?.fields?.[name]) setAtPath(next, adapter.fields[name], value); };
    ["entryType", "date", "workout", "duration", "energy", "timeCrunch", "painStopped", "notes"].forEach((name) => writeField(name, view[name]));
    const definition = adapter?.workouts?.[view.workout];
    for (const exercise of definition?.exercises || []) {
      const edited = (view.exercises || []).find((candidate) => exerciseIdentity(candidate) === exerciseIdentity(exercise));
      if (!edited) continue;
      exercise.sets.forEach((set, index) => {
        if (set.paths.weight) setAtPath(next, set.paths.weight, edited.sets?.[index]?.weight ?? null);
        if (set.paths.reps) setAtPath(next, set.paths.reps, edited.sets?.[index]?.reps ?? null);
        if (set.paths.seconds) setAtPath(next, set.paths.seconds, edited.sets?.[index]?.seconds ?? null);
      });
    }
    return next;
  }

  return Object.freeze({
    EQUIPMENT, clone, equipment, roundToIncrement, suggestDefaults, warmupLoads, plateCalculator,
    findPreviousSet, copyScope, proposeWorkingLoad, validateWorkout, progressionSuggestion,
    personalRecords, exerciseTrend, timerReducer, completeSet, deriveLegacyAdapter, legacyToView, viewToLegacy, inferEquipment,
  });
});
