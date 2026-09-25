/**
 * @jest-environment node
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const {
  ensureServiceWorkerBuildMatch,
  readServiceWorkerBuildId,
} = require("../scripts/service-worker-build-guard") as {
  ensureServiceWorkerBuildMatch(options: {
    root: string;
    distDir?: string;
    runGenerator?: (context: { buildId: string; serviceWorkerPath: string }) => void;
  }): { buildId: string; regenerated: boolean };
  readServiceWorkerBuildId(serviceWorkerPath: string): string | null;
};

function makeFixture(buildId: string, workerBuildId: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sn-216-worker-"));
  fs.mkdirSync(path.join(root, ".next"), { recursive: true });
  fs.mkdirSync(path.join(root, "public"), { recursive: true });
  fs.writeFileSync(path.join(root, ".next", "BUILD_ID"), `${buildId}\n`, "utf8");
  fs.writeFileSync(
    path.join(root, "public", "service-worker.js"),
    `const BUILD_ID = "${workerBuildId}";\n`,
    "utf8"
  );
  return root;
}

describe("SN-216 production service-worker build guard", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("regenerates a stale worker from the exact production bundle before startup", () => {
    const root = makeFixture("next-build-current", "worker-build-stale");
    roots.push(root);
    const runGenerator = jest.fn(
      ({ buildId, serviceWorkerPath }: { buildId: string; serviceWorkerPath: string }) => {
        fs.writeFileSync(serviceWorkerPath, `const BUILD_ID = "${buildId}";\n`, "utf8");
      }
    );

    expect(ensureServiceWorkerBuildMatch({ root, runGenerator })).toEqual({
      buildId: "next-build-current",
      regenerated: true,
    });
    expect(runGenerator).toHaveBeenCalledTimes(1);
    expect(readServiceWorkerBuildId(path.join(root, "public", "service-worker.js"))).toBe(
      "next-build-current"
    );
  });

  it("does not rewrite a worker that already matches the production bundle", () => {
    const root = makeFixture("same-build", "same-build");
    roots.push(root);
    const runGenerator = jest.fn();

    expect(ensureServiceWorkerBuildMatch({ root, runGenerator })).toEqual({
      buildId: "same-build",
      regenerated: false,
    });
    expect(runGenerator).not.toHaveBeenCalled();
  });

  it("blocks startup when regeneration still leaves a mismatched worker", () => {
    const root = makeFixture("next-build-current", "worker-build-stale");
    roots.push(root);

    expect(() =>
      ensureServiceWorkerBuildMatch({ root, runGenerator: () => undefined })
    ).toThrow("Service-worker build mismatch");
  });
});
