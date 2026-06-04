#!/usr/bin/env node
/**
 * hackernews-mcp-server
 *
 * A Model Context Protocol (MCP) server that exposes the public Hacker News
 * API as a set of tools and resources, so any MCP-compatible client (Claude
 * Desktop, OpenClaw, etc.) can read top stories, stories, users, and comment
 * threads on demand.
 *
 * Transport: stdio. Run via `npx hackernews-mcp-server`.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import {
  getItem,
  getItems,
  getTopStoryIds,
  getUser,
  HNApiError,
  type HNItem,
} from "./hn-client.js";
import {
  formatCommentTree,
  formatStoryDetail,
  formatStoryLine,
  formatUser,
} from "./format.js";

const server = new McpServer({
  name: "hackernews-mcp-server",
  version: "1.0.0",
});

/** Wrap a string into the MCP text-content result shape. */
function text(value: string) {
  return { content: [{ type: "text" as const, text: value }] };
}

/** Wrap a string into an MCP error result (isError flips client handling). */
function error(value: string) {
  return { content: [{ type: "text" as const, text: value }], isError: true };
}

/**
 * Run a tool handler, converting any HN API / network failure into a clean
 * MCP error result instead of crashing the server.
 */
async function safely(
  label: string,
  fn: () => Promise<ReturnType<typeof text>>,
): Promise<ReturnType<typeof text>> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof HNApiError) {
      return error(`${label}: ${err.message}`);
    }
    const message = err instanceof Error ? err.message : String(err);
    return error(`${label}: unexpected error — ${message}`);
  }
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

server.registerTool(
  "get_top_stories",
  {
    title: "Get Top Stories",
    description:
      "Get the current top stories on Hacker News, ranked by HN's front-page algorithm. Returns title, score, comment count, author, and links.",
    inputSchema: {
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .default(10)
        .describe("How many top stories to return (1-50, default 10)."),
    },
  },
  async ({ limit }) =>
    safely("get_top_stories", async () => {
      const ids = await getTopStoryIds();
      const stories = await getItems(ids.slice(0, limit));
      if (stories.length === 0) return text("No top stories are available right now.");
      const body = stories.map((s, i) => formatStoryLine(s, i)).join("\n\n");
      return text(`Top ${stories.length} Hacker News stories:\n\n${body}`);
    }),
);

server.registerTool(
  "get_story",
  {
    title: "Get Story",
    description:
      "Get full details for a single Hacker News story (or job/poll) by its numeric item id, including score, author, URL, and body text.",
    inputSchema: {
      id: z.number().int().positive().describe("The numeric Hacker News item id."),
    },
  },
  async ({ id }) =>
    safely("get_story", async () => {
      const item = await getItem(id);
      if (!item) return text(`No item found with id ${id}.`);
      return text(formatStoryDetail(item));
    }),
);

server.registerTool(
  "get_user",
  {
    title: "Get User",
    description:
      "Get a Hacker News user's public profile: karma, account age, submission count, and 'about' text.",
    inputSchema: {
      username: z
        .string()
        .min(1)
        .max(64)
        .describe("The case-sensitive Hacker News username (e.g. 'pg')."),
    },
  },
  async ({ username }) =>
    safely("get_user", async () => {
      const user = await getUser(username);
      if (!user) return text(`No user found with username '${username}'.`);
      return text(formatUser(user));
    }),
);

server.registerTool(
  "search_stories",
  {
    title: "Search Top Stories",
    description:
      "Search the current Hacker News front page for stories whose title contains the given query (case-insensitive substring match). Useful for topical scans like 'rust', 'AI', or a company name.",
    inputSchema: {
      query: z.string().min(1).max(100).describe("Substring to match against story titles."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(30)
        .default(10)
        .describe("Maximum number of matches to return (1-30, default 10)."),
      pool: z
        .number()
        .int()
        .min(10)
        .max(200)
        .default(100)
        .describe("How many top stories to scan through (10-200, default 100)."),
    },
  },
  async ({ query, limit, pool }) =>
    safely("search_stories", async () => {
      const ids = await getTopStoryIds();
      const stories = await getItems(ids.slice(0, pool));
      const needle = query.toLowerCase();
      const matches = stories
        .filter((s) => (s.title ?? "").toLowerCase().includes(needle))
        .slice(0, limit);
      if (matches.length === 0) {
        return text(`No front-page stories matched "${query}" (scanned ${stories.length}).`);
      }
      const body = matches.map((s, i) => formatStoryLine(s, i)).join("\n\n");
      return text(
        `Found ${matches.length} front-page stor${matches.length === 1 ? "y" : "ies"} matching "${query}":\n\n${body}`,
      );
    }),
);

server.registerTool(
  "get_comments",
  {
    title: "Get Comments",
    description:
      "Get the comment thread for a Hacker News story, rendered as an indented tree up to a chosen depth. Great for summarizing discussion.",
    inputSchema: {
      id: z.number().int().positive().describe("The numeric Hacker News story id."),
      depth: z
        .number()
        .int()
        .min(1)
        .max(4)
        .default(2)
        .describe("How many levels of nested replies to traverse (1-4, default 2)."),
      maxComments: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(30)
        .describe("Cap on total comments fetched, to bound size (1-100, default 30)."),
    },
  },
  async ({ id, depth, maxComments }) =>
    safely("get_comments", async () => {
      const story = await getItem(id);
      if (!story) return text(`No item found with id ${id}.`);

      // Breadth-first traversal, bounded by depth and a global comment budget.
      const children = new Map<number, HNItem[]>();
      const roots: HNItem[] = [];
      let budget = maxComments;
      let frontier = (story.kids ?? []).map((kid) => ({ id: kid, level: 0 }));

      while (frontier.length > 0 && budget > 0) {
        const slice = frontier.slice(0, budget);
        const items = await getItems(slice.map((f) => f.id));
        const byId = new Map(items.map((it) => [it.id, it]));
        const next: { id: number; level: number }[] = [];

        for (const { id: cid, level } of slice) {
          const comment = byId.get(cid);
          if (!comment) continue;
          budget -= 1;
          if (level === 0) roots.push(comment);
          else {
            const siblings = children.get(comment.parent ?? -1) ?? [];
            siblings.push(comment);
            children.set(comment.parent ?? -1, siblings);
          }
          if (level + 1 < depth) {
            for (const kid of comment.kids ?? []) next.push({ id: kid, level: level + 1 });
          }
        }
        frontier = next;
      }

      if (roots.length === 0) return text(`Story ${id} has no comments.`);
      const rendered = roots.map((c) => formatCommentTree(c, children)).join("\n\n");
      return text(
        `Comments for "${story.title ?? id}" (depth ${depth}, up to ${maxComments}):\n\n${rendered}`,
      );
    }),
);

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------

server.registerResource(
  "top-stories",
  "hn://top",
  {
    title: "Hacker News Top Stories",
    description: "A live snapshot of the current Hacker News front page as JSON.",
    mimeType: "application/json",
  },
  async (uri) => {
    const ids = await getTopStoryIds();
    const stories = await getItems(ids.slice(0, 30));
    const payload = stories.map((s) => ({
      id: s.id,
      title: s.title,
      by: s.by,
      score: s.score ?? 0,
      comments: s.descendants ?? 0,
      url: s.url ?? `https://news.ycombinator.com/item?id=${s.id}`,
    }));
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(payload, null, 2),
        },
      ],
    };
  },
);

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Log to stderr only — stdout is reserved for the MCP protocol stream.
  console.error("hackernews-mcp-server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error starting hackernews-mcp-server:", err);
  process.exit(1);
});
