import { parse, stringify } from "yaml";
import { VaultError } from "./errors";
import type { FrontmatterData } from "./types";

const FRONTMATTER_BOUNDARY = "---";

function normalizeNewlines(value: string) {
  return value.replace(/\r\n/g, "\n");
}

export function parseFrontmatterDocument(source: string) {
  const normalized = normalizeNewlines(source);

  if (!normalized.startsWith(`${FRONTMATTER_BOUNDARY}\n`)) {
    return {
      metadata: {} as FrontmatterData,
      body: normalized,
    };
  }

  const endIndex = normalized.indexOf(`\n${FRONTMATTER_BOUNDARY}\n`, FRONTMATTER_BOUNDARY.length + 1);
  if (endIndex === -1) {
    throw new VaultError(
      "MALFORMED_FRONTMATTER",
      "Front matter block is not closed with a terminating --- line.",
      400
    );
  }

  const yamlBlock = normalized.slice(FRONTMATTER_BOUNDARY.length + 1, endIndex);
  const body = normalized.slice(endIndex + `\n${FRONTMATTER_BOUNDARY}\n`.length);

  let parsed: unknown;
  try {
    parsed = yamlBlock.trim() ? parse(yamlBlock) : {};
  } catch (error) {
    throw new VaultError(
      "MALFORMED_FRONTMATTER",
      error instanceof Error ? error.message : "Failed to parse front matter.",
      400
    );
  }

  if (parsed === null || parsed === undefined) {
    return {
      metadata: {} as FrontmatterData,
      body,
    };
  }

  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new VaultError(
      "MALFORMED_FRONTMATTER",
      "Front matter must be a YAML object.",
      400
    );
  }

  return {
    metadata: parsed as FrontmatterData,
    body,
  };
}

export function serializeFrontmatterDocument(
  metadata: FrontmatterData,
  body: string
) {
  const normalizedBody = normalizeNewlines(body);
  const serialized = stringify(metadata).trimEnd();
  return `${FRONTMATTER_BOUNDARY}\n${serialized}\n${FRONTMATTER_BOUNDARY}\n${normalizedBody}`;
}
