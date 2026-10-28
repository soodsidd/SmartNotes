/** Default editor language for notebooks created without an explicit language. */
export const DEFAULT_NOTEBOOK_LANGUAGE_INFO = {
  codemirror_mode: { name: "ipython", version: 3 },
  file_extension: ".py",
  mimetype: "text/x-python",
  name: "python",
  nbconvert_exporter: "python",
  pygments_lexer: "ipython3",
} as const;

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function withNotebookLanguageDefault(metadata: Record<string, unknown>): Record<string, unknown> {
  if (record(metadata.language_info)) return metadata;
  const kernel = metadata.kernelspec;
  if (record(kernel) && typeof kernel.language === "string" && kernel.language.toLowerCase() !== "python") {
    return metadata;
  }
  return { ...metadata, language_info: DEFAULT_NOTEBOOK_LANGUAGE_INFO };
}
