import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
process.env.NODE_ENV = "production";
process.env.SMART_NOTES_VAULT = path.join(root, ".e2e-vault-sn295");
process.env.SMART_NOTES_STATE_DIR = path.join(root, ".e2e-state-sn295");
await import("../../server.js");
