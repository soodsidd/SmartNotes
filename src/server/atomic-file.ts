import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const mutationQueues = new Map<string, Promise<void>>();

export async function withFileMutation<T>(filePath: string, operation: () => Promise<T>): Promise<T> {
  const key = process.platform === "win32" ? filePath.toLowerCase() : filePath;
  const previous = mutationQueues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.catch(() => undefined).then(() => gate);
  mutationQueues.set(key, queued);
  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
    if (mutationQueues.get(key) === queued) mutationQueues.delete(key);
  }
}

async function replaceWithRetry(temporaryPath: string, targetPath: string): Promise<void> {
  const transientCodes = new Set(["EPERM", "EACCES", "EEXIST", "EXDEV"]);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await fs.rename(temporaryPath, targetPath);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? "";
      if (!transientCodes.has(code)) throw error;
      if (attempt < 4) {
        await new Promise((resolve) => setTimeout(resolve, 40 * (attempt + 1)));
        continue;
      }
      // Matches the existing Windows/EXDEV convention. This final fallback is
      // replacement-compatible, but is not a filesystem-wide atomic CAS.
      await fs.copyFile(temporaryPath, targetPath);
      await fs.rm(temporaryPath, { force: true });
      return;
    }
  }
}

export async function atomicReplaceFile(
  targetPath: string,
  content: string | Uint8Array,
  options: {
    encoding?: BufferEncoding;
    mode?: number;
    beforeReplace?: () => Promise<void>;
  } = {}
): Promise<void> {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const temporaryPath = path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.${process.pid}.${crypto.randomUUID()}.tmp`
  );
  try {
    await fs.writeFile(temporaryPath, content, {
      flag: "wx",
      ...(options.encoding ? { encoding: options.encoding } : {}),
      ...(options.mode !== undefined ? { mode: options.mode } : {}),
    });
    await options.beforeReplace?.();
    await replaceWithRetry(temporaryPath, targetPath);
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

export function isUtf16Boundary(source: string, offset: number): boolean {
  if (!Number.isInteger(offset) || offset < 0 || offset > source.length) return false;
  if (offset === 0 || offset === source.length) return true;
  const previous = source.charCodeAt(offset - 1);
  const current = source.charCodeAt(offset);
  return !(previous >= 0xd800 && previous <= 0xdbff && current >= 0xdc00 && current <= 0xdfff);
}

export function resetFileMutationQueuesForTesting(): void {
  mutationQueues.clear();
}
