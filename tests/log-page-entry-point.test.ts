import fs from "node:fs";
import path from "node:path";

import { focusedLogUrl } from "@/lib/api/log";

describe("notebook log focused-shell entry point (SN-149)", () => {
  it("builds an encoded focused-shell URL for the selected log page", () => {
    expect(focusedLogUrl("Notebook/Workout Log.html")).toBe(
      "/log?path=Notebook%2FWorkout%20Log.html"
    );
  });

  it("wires notebook-hosted logs to the focused bridge without enabling local-first mode", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "../src/components/notebook-shell-reliable.tsx"),
      "utf8"
    );
    const logBranch = source.slice(
      source.indexOf('draft.noteType === "log"'),
      source.indexOf('draft.noteType === "jupyter"')
    );

    expect(logBranch).toContain("focusedShellHref={focusedLogUrl(draft.path)}");
    expect(logBranch).not.toContain("focusedLocalFirst");
  });
});
