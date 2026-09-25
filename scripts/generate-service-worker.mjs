import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const templatePath = path.join(__dirname, "service-worker.template.js");
const outputPath = path.join(root, "public", "service-worker.js");

function resolveBuildId() {
  const nextDistDir = process.env.SMART_NOTES_NEXT_DIST_DIR || ".next";
  const buildIdPath = path.join(root, nextDistDir, "BUILD_ID");
  if (fs.existsSync(buildIdPath)) {
    return fs.readFileSync(buildIdPath, "utf8").trim();
  }

  try {
    return execSync("git rev-parse --short HEAD", { cwd: root, encoding: "utf8" }).trim();
  } catch {
    return "dev";
  }
}

const buildId = resolveBuildId();
const template = fs.readFileSync(templatePath, "utf8");
const output = template.replaceAll("__BUILD_ID__", buildId);

fs.writeFileSync(outputPath, output, "utf8");
console.log(`[generate-service-worker] wrote public/service-worker.js (BUILD_ID=${buildId})`);
