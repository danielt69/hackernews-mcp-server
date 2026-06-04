/**
 * Thin, typed client for the public Hacker News Firebase API.
 *
 * Docs: https://github.com/HackerNews/API
 * Base: https://hacker-news.firebaseio.com/v0/  (no auth, no API keys)
 */

const HN_API_BASE = "https://hacker-news.firebaseio.com/v0";
const HN_ITEM_URL = (id: number) => `https://news.ycombinator.com/item?id=${id}`;
const HN_USER_URL = (id: string) => `https://news.ycombinator.com/user?id=${id}`;

/** A Hacker News item: story, comment, job, poll, or pollopt. */
export interface HNItem {
  id: number;
  type?: "story" | "comment" | "job" | "poll" | "pollopt";
  by?: string;
  time?: number;
  text?: string;
  url?: string;
  title?: string;
  score?: number;
  descendants?: number;
  kids?: number[];
  parent?: number;
  deleted?: boolean;
  dead?: boolean;
}

/** A Hacker News user profile. */
export interface HNUser {
  id: string;
  created?: number;
  karma?: number;
  about?: string;
  submitted?: number[];
}

/**
 * Raised when the Hacker News API cannot be reached or returns a non-OK
 * response. Carries enough context to produce a useful tool error message.
 */
export class HNApiError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "HNApiError";
  }
}

const DEFAULT_TIMEOUT_MS = 10_000;

async function fetchJson<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "hackernews-mcp-server" },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new HNApiError(
        `Hacker News API returned ${res.status} ${res.statusText} for ${url}`,
      );
    }
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof HNApiError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new HNApiError(`Request to ${url} timed out after ${DEFAULT_TIMEOUT_MS}ms`, err);
    }
    throw new HNApiError(`Failed to reach Hacker News API at ${url}`, err);
  } finally {
    clearTimeout(timeout);
  }
}

/** Fetch the ordered list of current top story IDs (up to 500). */
export function getTopStoryIds(): Promise<number[]> {
  return fetchJson<number[]>(`${HN_API_BASE}/topstories.json`);
}

/** Fetch the ordered list of newest story IDs. */
export function getNewStoryIds(): Promise<number[]> {
  return fetchJson<number[]>(`${HN_API_BASE}/newstories.json`);
}

/** Fetch a single item (story, comment, job, poll) by id. Returns null if not found. */
export async function getItem(id: number): Promise<HNItem | null> {
  const item = await fetchJson<HNItem | null>(`${HN_API_BASE}/item/${id}.json`);
  return item ?? null;
}

/** Fetch a user profile by username. Returns null if the user does not exist. */
export async function getUser(username: string): Promise<HNUser | null> {
  const user = await fetchJson<HNUser | null>(
    `${HN_API_BASE}/user/${encodeURIComponent(username)}.json`,
  );
  return user ?? null;
}

/**
 * Fetch many items concurrently while bounding fan-out so we never open
 * hundreds of sockets at once. Missing items are filtered out.
 */
export async function getItems(ids: number[], concurrency = 8): Promise<HNItem[]> {
  const results: HNItem[] = [];
  for (let i = 0; i < ids.length; i += concurrency) {
    const batch = ids.slice(i, i + concurrency);
    const items = await Promise.all(batch.map((id) => getItem(id)));
    for (const item of items) {
      if (item && !item.deleted && !item.dead) results.push(item);
    }
  }
  return results;
}

/** Human-readable permalink helpers, useful when formatting tool output. */
export const links = {
  item: HN_ITEM_URL,
  user: HN_USER_URL,
};
