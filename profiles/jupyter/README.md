# Smart Notes Jupyter profile

This optional, repo-local virtual environment makes JupyterLab autocomplete and
Python signature help predictable. Smart Notes prefers its `jupyter` executable
over a bare `jupyter` on `PATH`, but keeps the existing `PATH` fallback when this
profile is absent. The virtual environment itself is ignored by Git and is not
bundled with Smart Notes.

From the Smart Notes repository root on Windows PowerShell:

```powershell
python -m venv profiles/jupyter/.venv
& .\profiles\jupyter\.venv\Scripts\python.exe -m pip install --upgrade pip
& .\profiles\jupyter\.venv\Scripts\python.exe -m pip install -r profiles/jupyter/requirements.txt
```

On macOS or Linux:

```bash
python3 -m venv profiles/jupyter/.venv
profiles/jupyter/.venv/bin/python -m pip install --upgrade pip
profiles/jupyter/.venv/bin/python -m pip install -r profiles/jupyter/requirements.txt
```

For deployments that keep the virtual environment elsewhere, set
`SMART_NOTES_JUPYTER_PROFILE_DIR` to its root (the directory containing
`Scripts/` on Windows or `bin/` on macOS/Linux).

At each notebook launch Smart Notes writes Jupyter config and Lab user-setting
overrides into the OS temporary directory. It never writes these settings into a
note's `.jupyter` folder and never modifies an existing `.ipynb`; all notebooks
inherit the profile the next time they launch, with no migration.

The managed profile also includes the standard JupyterLab Git panel, nbdime
notebook diffs, and nbstripout. The Git panel uses the page's Deep Work folder
or the selected project root. It shows **Initialize Repository** in a folder
without Git; Smart Notes does not initialize it automatically or change an
existing repository's remotes. Notebook diffs in the panel use nbdime. During
Lab staging/commits, a session-scoped Git clean filter strips notebook outputs
from Git while leaving the working notebook intact. Session-scoped ignore rules
cover checkpoints, Python caches, virtual environments, and common OS junk.
These defaults do not edit a repository's `.git/config`, `.gitignore`, or
`.gitattributes`, and repository attributes can opt out of the notebook filter.
Git commands outside the managed Lab session keep their own configuration.

**Settings → JupyterLab profile** reports whether the Git panel, nbdime, and
nbstripout are available. If one is missing, Lab still opens; reinstall the
requirements above to restore the complete profile.
