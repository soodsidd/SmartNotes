/**
 * SN-381: cell-source fingerprint shared by the server cell runner and the
 * injected JupyterLab bridge (`sourceRevision` in server/jupyter-focus-bridge.js
 * is the same algorithm; tests/jupyter-cell-run-live-bridge.test.ts pins
 * parity). It lets the frame prove the cell it decorates holds the exact
 * source that ran. Not a security boundary - persistence compares full source.
 */
export function cellSourceRevision(value: string): string {
  const text = typeof value === "string" ? value : String(value ?? "");
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193) >>> 0;
    second = Math.imul(second ^ (code + index), 0x85ebca6b) >>> 0;
  }
  return `${text.length}:${first.toString(16).padStart(8, "0")}${second.toString(16).padStart(8, "0")}`;
}
