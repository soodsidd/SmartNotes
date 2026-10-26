/**
 * Curated git defaults for managed JupyterLab sessions (SN-388).
 *
 * jupyterlab-git and nbdime ship with the Smart Notes Jupyter profile and run
 * inside the Lab server. This module adds the two defaults they do not provide
 * on their own, without writing anything into a page folder, a project root,
 * or any repository:
 *
 *   - Notebook outputs are stripped on commit through an nbstripout clean
 *     filter. The working copy keeps its outputs; only what git stores is
 *     stripped.
 *   - Checkpoints and common junk (`.ipynb_checkpoints/`, `__pycache__/`,
 *     `.virtual_documents/`, virtualenvs, OS files) are ignored.
 *
 * Both are applied through git's environment-supplied config
 * (`GIT_CONFIG_COUNT` / `GIT_CONFIG_KEY_n` / `GIT_CONFIG_VALUE_n`, git 2.31+)
 * on the Lab server process. Every git command that the Lab git panel or a Lab
 * terminal runs inherits them. Git run anywhere else does not see them.
 *
 * Setting `core.excludesFile` / `core.attributesFile` this way would hide the
 * owner's own global ignore and attributes files, so the session files
 * generated here include the owner's global content after the curated lines.
 * A repository's own `.gitignore` / `.gitattributes` always takes precedence,
 * so a repo can opt out with `*.ipynb -filter` in its `.gitattributes`.
 *
 * Nothing here runs `git init`, edits remotes, or touches `.git/config`.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/** Ignore rules applied to every repository opened from a managed Lab session. */
export const CURATED_GIT_IGNORE = [
  ".ipynb_checkpoints/",
  "__pycache__/",
  "*.py[cod]",
  ".virtual_documents/",
  ".venv/",
  "venv/",
  ".pytest_cache/",
  ".mypy_cache/",
  ".ruff_cache/",
  ".DS_Store",
  "Thumbs.db",
  "desktop.ini",
];

export const GIT_IGNORE_FILE_NAME = "smart_notes_gitignore";
export const GIT_ATTRIBUTES_FILE_NAME = "smart_notes_gitattributes";

export interface GitProfileOptions {
  /** Per-session artifact directory (OS temp). The generated files are written here. */
  artifactDir: string;
  /** Absolute path to the nbstripout executable, or null when it is not available. */
  nbstripoutExecutable: string | null;
  /** Environment to read the owner's global git settings and existing GIT_CONFIG_* entries from. */
  baseEnv?: NodeJS.ProcessEnv;
  /** Owner global `core.excludesFile` / `core.attributesFile` paths (already resolved). Tests inject these. */
  userGlobalFiles?: { excludesFile: string | null; attributesFile: string | null };
}

export interface GitProfileResult {
  /** Environment variables to merge into the Lab server process environment. */
  env: Record<string, string>;
  stripOutputs: boolean;
  ignoreFile: string;
  attributesFile: string | null;
}

/** Git runs filters through `sh`, so quote the executable and use forward slashes. */
function shellCommand(executable: string, ...args: string[]): string {
  return [`"${executable.replace(/\\/g, "/")}"`, ...args].join(" ");
}

function xdgGitFile(name: "ignore" | "attributes", env: NodeJS.ProcessEnv): string {
  const xdg = env.XDG_CONFIG_HOME?.trim();
  const base = xdg ? xdg : path.join(env.HOME?.trim() || os.homedir(), ".config");
  return path.join(base, "git", name);
}

function expandHome(filePath: string, env: NodeJS.ProcessEnv): string {
  if (filePath === "~" || filePath.startsWith("~/") || filePath.startsWith("~\\")) {
    return path.join(env.HOME?.trim() || os.homedir(), filePath.slice(1));
  }
  return filePath;
}

async function readOptional(filePath: string | null): Promise<string> {
  if (!filePath) return "";
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

/**
 * Combine the curated lines with the owner's own global file. The owner's
 * lines come last so, for any pattern both define, the owner's rule wins.
 */
function combine(header: string, curated: string[], ownerContent: string, ownerPath: string | null): string {
  const lines = [header, ...curated, ""];
  if (ownerContent.trim()) {
    lines.push(`# Owner global file: ${ownerPath ?? "(unknown)"}`, ownerContent.replace(/\s+$/, ""), "");
  }
  return lines.join("\n");
}

/**
 * Existing GIT_CONFIG_COUNT entries in the inherited environment are kept;
 * the curated entries are appended after them.
 */
function gitConfigEnv(entries: Array<[string, string]>, baseEnv: NodeJS.ProcessEnv): Record<string, string> {
  const existingCount = Number.parseInt(baseEnv.GIT_CONFIG_COUNT ?? "", 10);
  const offset = Number.isFinite(existingCount) && existingCount > 0 ? existingCount : 0;
  const env: Record<string, string> = { GIT_CONFIG_COUNT: String(offset + entries.length) };
  entries.forEach(([key, value], index) => {
    env[`GIT_CONFIG_KEY_${offset + index}`] = key;
    env[`GIT_CONFIG_VALUE_${offset + index}`] = value;
  });
  return env;
}

/** Resolve the owner's global ignore/attributes files the way git itself would. */
export function resolveUserGlobalGitFiles(
  readGlobalConfig: (key: string) => string | null,
  env: NodeJS.ProcessEnv = process.env
): { excludesFile: string | null; attributesFile: string | null } {
  const excludes = readGlobalConfig("core.excludesFile");
  const attributes = readGlobalConfig("core.attributesFile");
  return {
    excludesFile: excludes ? expandHome(excludes, env) : xdgGitFile("ignore", env),
    attributesFile: attributes ? expandHome(attributes, env) : xdgGitFile("attributes", env),
  };
}

/** Write the session git files and return the env that activates them. */
export async function prepareGitProfile(options: GitProfileOptions): Promise<GitProfileResult> {
  const baseEnv = options.baseEnv ?? process.env;
  const userFiles = options.userGlobalFiles ?? { excludesFile: null, attributesFile: null };
  const ignoreFile = path.join(options.artifactDir, GIT_IGNORE_FILE_NAME);
  const stripOutputs = Boolean(options.nbstripoutExecutable);

  await fs.writeFile(
    ignoreFile,
    combine(
      "# Smart Notes managed Lab git ignore (SN-388). Generated per Jupyter session; do not edit.",
      CURATED_GIT_IGNORE,
      await readOptional(userFiles.excludesFile),
      userFiles.excludesFile
    ),
    "utf8"
  );

  const entries: Array<[string, string]> = [["core.excludesFile", ignoreFile.replace(/\\/g, "/")]];
  let attributesFile: string | null = null;
  if (options.nbstripoutExecutable) {
    attributesFile = path.join(options.artifactDir, GIT_ATTRIBUTES_FILE_NAME);
    await fs.writeFile(
      attributesFile,
      combine(
        "# Smart Notes managed Lab git attributes (SN-388). Generated per Jupyter session; do not edit.",
        ["*.ipynb filter=nbstripout diff=ipynb"],
        await readOptional(userFiles.attributesFile),
        userFiles.attributesFile
      ),
      "utf8"
    );
    // Same filter/diff definitions `nbstripout --install` writes, scoped to this session.
    entries.push(
      ["core.attributesFile", attributesFile.replace(/\\/g, "/")],
      ["filter.nbstripout.clean", shellCommand(options.nbstripoutExecutable)],
      ["filter.nbstripout.smudge", "cat"],
      ["filter.nbstripout.required", "true"],
      ["diff.ipynb.textconv", shellCommand(options.nbstripoutExecutable, "-t")]
    );
  }

  return { env: gitConfigEnv(entries, baseEnv), stripOutputs, ignoreFile, attributesFile };
}

