/**
 * SN-387: managed Jupyter kernels live-import module code from the page or
 * project folder (IPython autoreload 2 + workspace root / src on sys.path).
 *
 * The unit block pins the generated server and kernel config. The integration
 * block drives a real ipykernel through the exact generated files whenever the
 * Smart Notes Jupyter profile Python is available (set
 * SMART_NOTES_TEST_JUPYTER_PYTHON or SMART_NOTES_JUPYTER_PROFILE_DIR, or keep
 * the default profiles/jupyter/.venv), editing an imported module between two
 * executes on the same kernel without a restart.
 */
import { spawnSync } from "node:child_process";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { __testInternals } from "@/server/jupyter/runtime";

function profilePython(): string | null {
  const explicit = process.env.SMART_NOTES_TEST_JUPYTER_PYTHON?.trim();
  if (explicit) return fsSync.existsSync(explicit) ? explicit : null;
  const profileRoot = process.env.SMART_NOTES_JUPYTER_PROFILE_DIR?.trim()
    ? path.resolve(process.env.SMART_NOTES_JUPYTER_PROFILE_DIR.trim())
    : path.resolve(process.cwd(), "profiles", "jupyter", ".venv");
  const candidate = process.platform === "win32"
    ? path.join(profileRoot, "Scripts", "python.exe")
    : path.join(profileRoot, "bin", "python");
  return fsSync.existsSync(candidate) ? candidate : null;
}

describe("SN-387 managed kernel live-import config", () => {
  it("builds an additive IPython kernel config with autoreload 2 and the workspace root on sys.path", () => {
    const cfg = __testInternals.buildKernelConfig("C:\\vault\\Notebook\\Section\\a.jupyter");
    expect(cfg).toContain('_sn_root = _sn_os.path.normpath(r"C:/vault/Notebook/Section/a.jupyter")');
    expect(cfg).toContain('(_sn_os.path.join(_sn_root, "src"), _sn_root)');
    expect(cfg).toContain("_sn_sys.path.insert(0, _sn_path)");
    // Lazy append keeps any extensions/exec_lines from the owner's profile.
    expect(cfg).toContain('c.InteractiveShellApp.extensions.append("autoreload")');
    expect(cfg).toContain('c.InteractiveShellApp.exec_lines.append("%autoreload 2")');
    expect(cfg).not.toMatch(/c\.InteractiveShellApp\.(extensions|exec_lines) =/);
    expect(cfg).not.toContain("\\");
  });

  it("routes ipykernel launches through the session kernel config only when one is supplied", () => {
    const folder = "C:\\vault\\Notebook\\Section\\a.jupyter";
    const without = __testInternals.buildConfig(folder, 8888, "tok123");
    expect(without).not.toContain("kernel_spec_manager_class");

    const withKernel = __testInternals.buildConfig(
      folder,
      8888,
      "tok123",
      [],
      "/",
      undefined,
      undefined,
      "C:\\Temp\\smart-notes-jupyter\\session-x\\smart_notes_kernel_config.py"
    );
    expect(withKernel).toContain("class SmartNotesKernelSpecManager(_SNBaseKernelSpecManager):");
    expect(withKernel).toContain('r"--config=C:/Temp/smart-notes-jupyter/session-x/smart_notes_kernel_config.py"');
    expect(withKernel).toContain("c.ServerApp.kernel_spec_manager_class = SmartNotesKernelSpecManager");
    // Failure to build the wrapper must never stop the server from starting.
    expect(withKernel).toMatch(/try:\n[\s\S]*except Exception:\n {4}pass/);
    // The page folder itself is never a config destination.
    expect(withKernel).toContain('root_dir = r"C:/vault/Notebook/Section/a.jupyter"');
    expect(withKernel).not.toContain("a.jupyter/smart_notes_kernel_config.py");
  });
});

const HARNESS = String.raw`
import json, os, sys, time
from traitlets.config import Config
from jupyter_client import KernelManager

server_cfg, kernel_cwd, steps_file = sys.argv[1:4]
namespace = {"c": Config(), "__file__": server_cfg}
with open(server_cfg, encoding="utf-8") as handle:
    exec(compile(handle.read(), server_cfg, "exec"), namespace)
manager_class = namespace["c"].ServerApp.kernel_spec_manager_class
km = KernelManager(kernel_name="python3", kernel_spec_manager=manager_class())
km.start_kernel(cwd=kernel_cwd)
kc = km.client()
kc.start_channels()
results = []
try:
    kc.wait_for_ready(timeout=90)

    def run(code):
        msg_id = kc.execute(code)
        out, err = [], None
        while True:
            msg = kc.get_iopub_msg(timeout=60)
            if msg["parent_header"].get("msg_id") != msg_id:
                continue
            kind = msg["msg_type"]
            if kind == "stream":
                out.append(msg["content"]["text"])
            elif kind == "error":
                err = msg["content"]["ename"] + ": " + msg["content"]["evalue"]
            elif kind == "status" and msg["content"]["execution_state"] == "idle":
                break
        return {"stdout": "".join(out).strip(), "error": err}

    with open(steps_file, encoding="utf-8") as handle:
        steps = json.load(handle)
    for step in steps:
        write = step.get("write")
        if write:
            # Real edits land seconds apart; keep mtimes strictly increasing.
            time.sleep(1.1)
            with open(write["path"], "w", encoding="utf-8") as handle:
                handle.write(write["content"])
        results.append(run(step["code"]))
finally:
    kc.stop_channels()
    km.shutdown_kernel(now=True)
print("SN387_RESULTS=" + json.dumps(results))
`;

interface Step {
  write?: { path: string; content: string };
  code: string;
}

async function runKernelSteps(python: string, workspaceRoot: string, kernelCwd: string, steps: Step[]) {
  const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), "smart-notes-sn387-session-"));
  try {
    const kernelConfigPath = path.join(artifactDir, "smart_notes_kernel_config.py");
    const serverConfigPath = path.join(artifactDir, "jupyter_server_config.py");
    await fs.writeFile(kernelConfigPath, __testInternals.buildKernelConfig(workspaceRoot), "utf8");
    await fs.writeFile(
      serverConfigPath,
      __testInternals.buildConfig(workspaceRoot, 0, "tok", [], "/", undefined, undefined, kernelConfigPath),
      "utf8"
    );
    const harnessPath = path.join(artifactDir, "harness.py");
    const stepsPath = path.join(artifactDir, "steps.json");
    await fs.writeFile(harnessPath, HARNESS, "utf8");
    await fs.writeFile(stepsPath, JSON.stringify(steps), "utf8");
    const result = spawnSync(python, [harnessPath, serverConfigPath, kernelCwd, stepsPath], {
      encoding: "utf8",
      timeout: 170_000,
      windowsHide: true,
    });
    const line = `${result.stdout || ""}`.split(/\r?\n/).find((entry) => entry.startsWith("SN387_RESULTS="));
    if (!line) {
      throw new Error(`Kernel harness failed (status ${result.status}): ${result.stderr || result.stdout || result.error}`);
    }
    return JSON.parse(line.slice("SN387_RESULTS=".length)) as Array<{ stdout: string; error: string | null }>;
  } finally {
    await fs.rm(artifactDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function userFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string, prefix: string) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (entry.name === "__pycache__") continue;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(path.join(dir, entry.name), rel);
      else out.push(rel);
    }
  }
  await walk(root, "");
  return out.sort();
}

const python = profilePython();
const describeKernel = python ? describe : describe.skip;
if (!python) {
  // Visible in the jest log so a skipped integration block is never mistaken for a pass.
  console.warn("[SN-387] Jupyter profile Python not found; real-kernel live-import tests skipped.");
}

describeKernel("SN-387 live import on a real managed kernel", () => {
  jest.setTimeout(180_000);

  it("reloads an edited module and a subdirectory module without a restart (no pyproject)", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "smart-notes-sn387-page-"));
    const folder = path.join(root, "analysis.jupyter");
    try {
      await fs.mkdir(path.join(folder, "lib"), { recursive: true });
      await fs.writeFile(path.join(folder, "notebook.ipynb"), "{}", "utf8");
      await fs.writeFile(path.join(folder, "helpers.py"), "def answer():\n    return 1\n", "utf8");
      await fs.writeFile(path.join(folder, "lib", "stats.py"), "def scale(x):\n    return x * 2\n", "utf8");

      const results = await runKernelSteps(python!, folder, folder, [
        { code: "import helpers\nfrom lib import stats\nprint(helpers.answer(), stats.scale(5))" },
        {
          write: { path: path.join(folder, "helpers.py"), content: "def answer():\n    return 2\n" },
          code: "print(helpers.answer())",
        },
        {
          write: { path: path.join(folder, "lib", "stats.py"), content: "def scale(x):\n    return x * 10\n" },
          code: "print(stats.scale(5))",
        },
        { code: "print(any(name.endswith('autoreload') for name in get_ipython().extension_manager.loaded))" },
      ]);

      expect(results.map((r) => r.error)).toEqual([null, null, null, null]);
      expect(results.map((r) => r.stdout)).toEqual(["1 10", "2", "50", "True"]);
      // Nothing was scaffolded into the page folder.
      expect(await userFiles(folder)).toEqual(["helpers.py", "lib/stats.py", "notebook.ipynb"]);
    } finally {
      await fs.rm(root, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("imports and reloads a src-layout package with a pyproject from a notebook in a subfolder", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "smart-notes-sn387-project-"));
    try {
      await fs.mkdir(path.join(root, "src", "mypkg"), { recursive: true });
      await fs.mkdir(path.join(root, "notebooks"), { recursive: true });
      await fs.writeFile(path.join(root, "pyproject.toml"), "[project]\nname = \"mypkg\"\nversion = \"0.1.0\"\n", "utf8");
      await fs.writeFile(path.join(root, "src", "mypkg", "__init__.py"), "", "utf8");
      await fs.writeFile(path.join(root, "src", "mypkg", "core.py"), "def greet():\n    return 'v1'\n", "utf8");
      await fs.writeFile(path.join(root, "notebooks", "explore.ipynb"), "{}", "utf8");

      const results = await runKernelSteps(python!, root, path.join(root, "notebooks"), [
        { code: "from mypkg import core\nprint(core.greet())" },
        {
          write: { path: path.join(root, "src", "mypkg", "core.py"), content: "def greet():\n    return 'v2'\n" },
          code: "print(core.greet())",
        },
      ]);

      expect(results).toEqual([
        { stdout: "v1", error: null },
        { stdout: "v2", error: null },
      ]);
    } finally {
      await fs.rm(root, { recursive: true, force: true }).catch(() => undefined);
    }
  });
});
