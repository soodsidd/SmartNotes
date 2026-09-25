import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { VaultError } from "@/server/vault/errors";

const execFileAsync = promisify(execFile);

export interface PickFileOptions {
  initialPath?: string;
  title?: string;
  /** Semicolon-separated Windows filter, e.g. `HTML files (*.html)|*.html` */
  filter?: string;
}

export interface PickFileResult {
  cancelled: boolean;
  path: string | null;
}

function resolveInitialDirectory(initialPath?: string) {
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

async function pickFileWindows(options: PickFileOptions = {}): Promise<PickFileResult> {
  const initialDirectory = resolveInitialDirectory(options.initialPath);
  const title = String(options.title ?? "Select an HTML file").replace(/'/g, "''");
  const filter = String(options.filter ?? "HTML files (*.html)|*.html|All files (*.*)|*.*").replace(
    /'/g,
    "''"
  );
  const initialDir = initialDirectory ? initialDirectory.replace(/'/g, "''") : "";

  const script = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "$dialog = New-Object System.Windows.Forms.OpenFileDialog",
    `$dialog.Title = '${title}'`,
    `$dialog.Filter = '${filter}'`,
    "$dialog.Multiselect = $false",
    "$dialog.CheckFileExists = $true",
    initialDir ? `$dialog.InitialDirectory = '${initialDir}'` : null,
    "$result = $dialog.ShowDialog()",
    "if ($result -eq [System.Windows.Forms.DialogResult]::OK) {",
    "  Write-Output $dialog.FileName",
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
      throw new VaultError("UNSUPPORTED", "PowerShell is required for the Windows file picker.", 501);
    }
    throw error;
  }
}

export async function pickNativeFile(options: PickFileOptions = {}): Promise<PickFileResult> {
  if (process.platform !== "win32") {
    throw new VaultError(
      "UNSUPPORTED",
      "The native file picker is only available when Smart Notes runs on Windows.",
      501
    );
  }

  return pickFileWindows(options);
}

export function isNativeFilePickerAvailable() {
  return process.platform === "win32";
}
