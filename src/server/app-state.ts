import os from "node:os";
import path from "node:path";

/** Mutable app state directory (backup settings, agent settings, chat runtime). */
export function getAppStateDir() {
  if (process.env.SMART_NOTES_STATE_DIR) {
    return path.resolve(process.env.SMART_NOTES_STATE_DIR);
  }

  if (process.env.CLI_CHAT_RUNTIME_DIR) {
    return path.resolve(process.env.CLI_CHAT_RUNTIME_DIR);
  }

  return path.join(os.homedir(), ".cli-chat", "dev-workspace", "smart-notes");
}
