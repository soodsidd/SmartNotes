import base from "../../playwright.config";
import { defineConfig } from "@playwright/test";

// SN-392 evidence harness: same isolated e2e server/vault, only the SN-392 walkthrough.
export default defineConfig({ ...base, testDir: ".", testMatch: "sn-392-*.spec.ts", globalSetup: "../../e2e/global-setup.ts" });
