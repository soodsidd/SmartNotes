#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const migration = require("./migration.cjs");

function args(argv) {
  const parsed = { command: argv[0] };
  for (let index = 1; index < argv.length; index += 1) {
    const match = /^--([^=]+)(?:=(.*))?$/.exec(argv[index]);
    if (!match) throw new Error(`Unexpected argument: ${argv[index]}`);
    const key = match[1].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    parsed[key] = match[2] ?? (argv[index + 1] && !argv[index + 1].startsWith("--") ? argv[++index] : true);
  }
  return parsed;
}

async function main() {
  const input = args(process.argv.slice(2));
  const appDir = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(.:)/, "$1")), "../app");
  const [sourceTemplate, domainSource] = await Promise.all([
    fs.readFile(path.join(appDir, "source.html"), "utf8"),
    fs.readFile(path.join(appDir, "domain.js"), "utf8"),
  ]);
  if (!sourceTemplate.includes("/*__WORKOUT_DOMAIN__*/")) throw new Error("maintained App source is missing its domain insertion point");
  const appSource = sourceTemplate.replace("/*__WORKOUT_DOMAIN__*/", domainSource);
  const options = {
    vaultRoot: input.vault || input.vaultCopy,
    pagePath: input.page || "Health/Strength/workout-log.html",
    backupDir: input.backup,
    expectedCount: input.expectedCount === undefined ? 13 : Number(input.expectedCount),
    rehearsal: Boolean(input.rehearsal || input.vaultCopy),
    ownerConfirmation: input.ownerConfirmed,
    runtimeUrl: input.runtimeUrl,
    appSource,
  };
  if (!input.command || !options.vaultRoot || !options.backupDir) throw new Error("command, --vault/--vault-copy, and --backup are required");
  let result;
  if (input.command === "backup") result = await migration.createBackup(options);
  else if (input.command === "verify") result = await migration.verifyBackup(options);
  else if (input.command === "restore") result = await migration.restoreBackup(options);
  else if (input.command === "migrate") result = await migration.migrate(options);
  else if (input.command === "rehearse") result = await migration.rehearse(options);
  else throw new Error(`Unknown command: ${input.command}`);
  if (input.report) await fs.writeFile(path.resolve(input.report), `${JSON.stringify(result, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`SN-183 migration refused: ${error.message}\n`);
  process.exitCode = 1;
});
