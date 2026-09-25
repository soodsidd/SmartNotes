import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { VaultError } from "@/server/vault/errors";

const execFileAsync = promisify(execFile);

export interface PickFolderOptions {
  initialPath?: string;
  title?: string;
}

export interface PickFolderResult {
  cancelled: boolean;
  path: string | null;
}

function resolveInitialPath(initialPath?: string) {
  const trimmed = String(initialPath ?? "").trim();
  if (!trimmed) {
    return null;
  }

  const resolved = path.resolve(trimmed);
  if (!fs.existsSync(resolved)) {
    return null;
  }

  const stat = fs.statSync(resolved);
  return stat.isDirectory() ? resolved : path.dirname(resolved);
}

async function pickFolderWindows(options: PickFolderOptions = {}): Promise<PickFolderResult> {
  const initialPath = resolveInitialPath(options.initialPath);
  const title = String(options.title ?? "Select a notebook folder").replace(/'/g, "''");
  const selectedPath = initialPath ? initialPath.replace(/'/g, "''") : "";

  const script = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
    `$dialog.Description = '${title}'`,
    "$dialog.ShowNewFolderButton = $true",
    selectedPath ? `$dialog.SelectedPath = '${selectedPath}'` : null,
    "$result = $dialog.ShowDialog()",
    "if ($result -eq [System.Windows.Forms.DialogResult]::OK) {",
    "  Write-Output $dialog.SelectedPath",
    "}",
  ]
    .filter(Boolean)
    .join("; ");

  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-STA", "-Command", script],
      { windowsHide: false, timeout: 10 * 60 * 1000 }
    );
    const picked = stdout.trim();
    if (!picked) {
      return { cancelled: true, path: null };
    }
    return { cancelled: false, path: path.resolve(picked) };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new VaultError("UNSUPPORTED", "PowerShell is required for the Windows folder picker.", 501);
    }
    throw error;
  }
}

export async function pickNativeFolder(options: PickFolderOptions = {}): Promise<PickFolderResult> {
  if (process.platform !== "win32") {
    throw new VaultError(
      "UNSUPPORTED",
      "The native folder picker is only available when Smart Notes runs on Windows.",
      501
    );
  }

  return pickFolderWindows(options);
}

export function isNativeFolderPickerAvailable() {
  return process.platform === "win32";
}
