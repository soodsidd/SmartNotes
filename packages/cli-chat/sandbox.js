/**
 * sandbox.js — CLI sandboxing profiles for chat agents.
 *
 * Controls what tools the CLI agents can use.  By default the agent is
 * read-only: it can read files, search, and browse the web, but cannot
 * execute arbitrary commands, edit files, or access the network.
 *
 * Apps override these via the `sandbox` key in ChatConfig.
 *
 * Each profile defines:
 *   claude.permissionMode   — Claude CLI --permission-mode flag
 *   claude.allowedTools     — whitelist (null = use permission-mode defaults)
 *   claude.disallowedTools  — blacklist (null = none)
 *   ghcopilot.autoApprove   — whether to pass --yolo
 *   codex.sandbox           — Codex CLI sandbox mode
 */

const PROFILES = {

  /** No tools at all — pure conversation, no file/shell access. */
  none: {
    claude: {
      permissionMode: 'plan',            // plan mode = no tool execution
      allowedTools: [],                   // empty = no tools
      disallowedTools: null,
    },
    ghcopilot: {
      autoApprove: false,
    },
    codex: {
      sandbox: 'read-only',
    },
    cursor: {
      autoApprove: false,
    },
  },

  /** Read-only — can read files, search codebases, browse web. No writes. */
  readonly: {
    claude: {
      permissionMode: 'default',
      allowedTools: ['Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'LS', 'TodoRead'],
      disallowedTools: null,
    },
    ghcopilot: {
      autoApprove: false,
    },
    codex: {
      sandbox: 'read-only',
    },
    cursor: {
      autoApprove: false,
    },
  },

  /** Can read and edit files, but no shell/bash execution. */
  editor: {
    claude: {
      permissionMode: 'acceptEdits',
      allowedTools: [
        'Read', 'Write', 'Edit', 'MultiEdit',
        'Glob', 'Grep', 'LS',
        'WebFetch', 'WebSearch',
        'TodoRead', 'TodoWrite',
      ],
      disallowedTools: ['Bash', 'Computer'],
    },
    ghcopilot: {
      autoApprove: false,
    },
    codex: {
      sandbox: 'workspace-write',
      webSearch: true,
    },
    cursor: {
      autoApprove: false,
      headlessAutoApprove: true,
    },
  },

  /**
   * Workspace — full file editing within the working directory only.
   * No shell, no browser, no computer control.  CLI cwd is set to
   * the configured workingDirectory so the agent can't escape it.
   */
  workspace: {
    claude: {
      permissionMode: 'acceptEdits',
      allowedTools: [
        'Read', 'Write', 'Edit', 'MultiEdit',
        'Glob', 'Grep', 'LS',
        'TodoRead', 'TodoWrite',
      ],
      disallowedTools: null,
    },
    ghcopilot: {
      autoApprove: false,
    },
    codex: {
      sandbox: 'workspace-write',
    },
    cursor: {
      autoApprove: false,
    },
  },

  /** Full access — all tools, auto-approve. USE WITH CAUTION. */
  full: {
    claude: {
      permissionMode: 'bypassPermissions',
      allowedTools: null,
      disallowedTools: null,
    },
    ghcopilot: {
      autoApprove: true,
    },
    codex: {
      sandbox: 'danger-full-access',
    },
    cursor: {
      autoApprove: true,
    },
  },
};

/** Default sandbox profile */
const DEFAULT_PROFILE = 'readonly';

/**
 * Resolve sandbox config. Accepts a profile name string or a custom object.
 * Returns a normalized { claude: {...}, ghcopilot: {...}, codex: {...} } object.
 */
function resolveSandbox(sandbox) {
  if (!sandbox) return PROFILES[DEFAULT_PROFILE];
  if (typeof sandbox === 'string') {
    return PROFILES[sandbox] || PROFILES[DEFAULT_PROFILE];
  }
  // Custom object — merge with readonly defaults for safety
  const base = { ...PROFILES[DEFAULT_PROFILE] };
  if (sandbox.claude) base.claude = { ...base.claude, ...sandbox.claude };
  if (sandbox.ghcopilot) base.ghcopilot = { ...base.ghcopilot, ...sandbox.ghcopilot };
  if (sandbox.codex) base.codex = { ...base.codex, ...sandbox.codex };
  if (sandbox.cursor) base.cursor = { ...base.cursor, ...sandbox.cursor };
  return base;
}

/**
 * Build Claude CLI args based on sandbox config.
 * Returns array of flag strings to append to CLI args.
 */
function claudeSandboxArgs(sandboxCfg) {
  const s = sandboxCfg.claude;
  const args = [];

  if (s.permissionMode === 'bypassPermissions') {
    args.push('--dangerously-skip-permissions');
  } else if (s.permissionMode) {
    args.push('--permission-mode', s.permissionMode);
  }

  if (s.allowedTools && s.allowedTools.length > 0) {
    args.push('--allowedTools', s.allowedTools.join(','));
  } else if (s.allowedTools && s.allowedTools.length === 0) {
    // Empty array = disable all tools. Pushed as ONE glued '--tools=' token,
    // not ['--tools', ''] — on Windows, spawn(cmd, args, { shell: true })
    // round-trips args through cmd.exe, which silently drops a genuinely
    // empty-string array element. That leaves a bare `--tools` with no value,
    // and because commander's `--tools <tools...>` is variadic it then
    // swallows the NEXT flag (e.g. `--model haiku`) as a tools value instead
    // of parsing it — the CLI silently falls back to its default model and
    // the full tool list stays enabled. `--tools=` is a single token that
    // survives cmd.exe's re-tokenization intact on every invocation path
    // (verified against the installed claude CLI on Windows for SN-247).
    args.push('--tools=');
  }

  if (s.disallowedTools && s.disallowedTools.length > 0) {
    args.push('--disallowedTools', s.disallowedTools.join(','));
  }

  return args;
}

function codexExecArgs(sandboxCfg, options = {}) {
  const mode = sandboxCfg.codex?.sandbox;
  const args = [];
  // `codex exec resume` does not accept --sandbox; the resumed session keeps its
  // original sandbox profile. Fresh `codex exec` invocations still need it.
  if (!options.resume) {
    if (mode === 'danger-full-access') args.push('--dangerously-bypass-approvals-and-sandbox');
    else if (mode === 'workspace-write') args.push('--sandbox', 'workspace-write');
    else args.push('--sandbox', 'read-only');
  } else if (mode === 'danger-full-access') {
    args.push('--dangerously-bypass-approvals-and-sandbox');
  }
  if (sandboxCfg.codex?.webSearch && options.webSearchSupported === true) {
    args.push('-c', 'tools.web_search=live');
  }
  return args;
}

function cursorHeadlessArgs(sandboxCfg) {
  const args = [];
  if (sandboxCfg.cursor?.autoApprove || sandboxCfg.cursor?.headlessAutoApprove) {
    args.push('--force');
  }
  return args;
}

module.exports = {
  PROFILES,
  DEFAULT_PROFILE,
  resolveSandbox,
  claudeSandboxArgs,
  codexExecArgs,
  cursorHeadlessArgs,
};
