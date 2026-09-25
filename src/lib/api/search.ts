import type { SearchResult } from "@/lib/search";

interface SearchResponse {
  results: SearchResult[];
}

async function readErrorMessage(response: Response, fallback: string) {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error || fallback;
  } catch {
    return fallback;
  }
}

export async function fetchSearchResults(query: string, signal?: AbortSignal): Promise<SearchResult[]> {
  const url = `/api/search?q=${encodeURIComponent(query)}`;
  const response = await fetch(url, {
    cache: "no-store",
    signal,
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Failed to search notes."));
  }

  const body = (await response.json()) as SearchResponse;
  return body.results;
}
