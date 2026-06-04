# hackernews-mcp-server

A [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server for the
public [Hacker News API](https://github.com/HackerNews/API), built with the
official [TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk).
It lets any MCP-compatible client — Claude Desktop, OpenClaw, Cursor, and others —
read the Hacker News front page, individual stories, user profiles, and comment
threads on demand.

## Why MCP?

The Model Context Protocol is a standard way to give LLMs typed, discoverable
access to external systems without baking custom glue into every app. Instead of
teaching a model to scrape a website or hand-rolling an API integration per
client, you expose a small set of well-described **tools** and **resources** once,
and every MCP-aware client can use them safely with validated inputs. This server
is a clean, dependency-light example of that pattern: a single read-only API,
wrapped as five tools and one resource, fully typed and validated end to end.

## Features

- Five focused tools and one live resource over the Hacker News Firebase API.
- Strong input validation with [zod](https://zod.dev) on every tool argument.
- Graceful error handling: network/API failures become clean tool errors, never
  crashes. Requests are timeout-bounded and fan-out is throttled.
- Fully typed TypeScript, strict mode, zero `any` in the public surface.
- `stdio` transport with an executable `bin` entry — runnable via `npx`.
- **No API key required.** The Hacker News API is public and unauthenticated.

## Install

```bash
# Run directly (no install) once published / from a clone build:
npx hackernews-mcp-server

# Or clone and build locally:
git clone https://github.com/danielt69/hackernews-mcp-server.git
cd hackernews-mcp-server
npm install
npm run build
node dist/index.js
```

Requires Node.js 18 or newer.

## Client configuration

Add the server to your MCP client config. For **Claude Desktop**, edit
`claude_desktop_config.json` (macOS:
`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "hackernews": {
      "command": "npx",
      "args": ["-y", "hackernews-mcp-server"]
    }
  }
}
```

For **OpenClaw** (or any client that takes a command + args), use the same block.
If you built from a local clone, point at the build output instead:

```json
{
  "mcpServers": {
    "hackernews": {
      "command": "node",
      "args": ["/absolute/path/to/hackernews-mcp-server/dist/index.js"]
    }
  }
}
```

## Tools

| Tool | Description | Parameters |
| --- | --- | --- |
| `get_top_stories` | Current Hacker News top stories with score, comments, author, and links. | `limit` (int, 1–50, default 10) |
| `get_story` | Full detail for a single item by id (story / job / poll), including body text. | `id` (positive int) |
| `get_user` | A user's public profile: karma, account age, submission count, about text. | `username` (string) |
| `search_stories` | Case-insensitive title search over the current front page. | `query` (string), `limit` (1–30, default 10), `pool` (10–200, default 100) |
| `get_comments` | Comment thread for a story, rendered as a depth-limited indented tree. | `id` (positive int), `depth` (1–4, default 2), `maxComments` (1–100, default 30) |

## Resources

| URI | Description | MIME type |
| --- | --- | --- |
| `hn://top` | Live snapshot of the current top 30 front-page stories as JSON. | `application/json` |

## Usage example

Once configured, ask your MCP client something like:

> "Use the hackernews tools to show me the top 5 stories, then summarize the
> discussion on the most-commented one."

The client will call `get_top_stories` with `limit: 5`, pick the story with the
most comments, then call `get_comments` with that story's `id` and summarize the
returned thread.

## Development

```bash
npm install
npm run typecheck   # tsc --noEmit
npm run build       # compile to dist/
npm run dev         # tsc --watch
```

## Project layout

```
src/
  index.ts       # MCP server: tool & resource registration, stdio bootstrap
  hn-client.ts   # typed Hacker News API client (fetch, timeouts, throttling)
  format.ts      # presentation helpers (Markdown / plain-text formatting)
```

## License

[MIT](./LICENSE) © Daniel Tsionit
