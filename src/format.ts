/**
 * Presentation helpers that turn raw Hacker News items into compact,
 * model-friendly Markdown / plain text.
 */

import { type HNItem, type HNUser, links } from "./hn-client.js";

/** Format a Unix timestamp (seconds) as an ISO-8601 UTC string. */
function isoTime(seconds?: number): string {
  if (!seconds) return "unknown";
  return new Date(seconds * 1000).toISOString();
}

/** Strip the HTML that Hacker News stores in comment/story `text` fields. */
export function stripHtml(html?: string): string {
  if (!html) return "";
  return html
    .replace(/<p>/gi, "\n\n")
    .replace(/<\/p>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/")
    .trim();
}

/** One-line summary of a story, ideal for lists. */
export function formatStoryLine(item: HNItem, index?: number): string {
  const rank = index !== undefined ? `${index + 1}. ` : "";
  const score = item.score ?? 0;
  const comments = item.descendants ?? 0;
  const title = item.title ?? "(untitled)";
  return [
    `${rank}${title}`,
    `   ${score} points · ${comments} comments · by ${item.by ?? "unknown"}`,
    `   ${item.url ?? links.item(item.id)}`,
    `   HN discussion: ${links.item(item.id)} (id: ${item.id})`,
  ].join("\n");
}

/** Detailed multi-line view of a single story. */
export function formatStoryDetail(item: HNItem): string {
  const lines = [
    `# ${item.title ?? "(untitled)"}`,
    "",
    `- ID: ${item.id}`,
    `- Author: ${item.by ?? "unknown"}`,
    `- Score: ${item.score ?? 0} points`,
    `- Comments: ${item.descendants ?? 0}`,
    `- Posted: ${isoTime(item.time)}`,
  ];
  if (item.url) lines.push(`- URL: ${item.url}`);
  lines.push(`- HN discussion: ${links.item(item.id)}`);
  const body = stripHtml(item.text);
  if (body) {
    lines.push("", "## Text", "", body);
  }
  return lines.join("\n");
}

/** Render a comment subtree as indented Markdown. */
export function formatCommentTree(
  comment: HNItem,
  children: Map<number, HNItem[]>,
  depth = 0,
): string {
  const indent = "  ".repeat(depth);
  const author = comment.by ?? "[deleted]";
  const text = stripHtml(comment.text) || "[no text]";
  const wrapped = text
    .split("\n")
    .map((line) => `${indent}  ${line}`)
    .join("\n");
  const header = `${indent}- ${author} (${isoTime(comment.time)}):`;
  const kids = children.get(comment.id) ?? [];
  const rendered = kids.map((child) => formatCommentTree(child, children, depth + 1));
  return [header, wrapped, ...rendered].join("\n");
}

/** Profile view for a user. */
export function formatUser(user: HNUser): string {
  const lines = [
    `# ${user.id}`,
    "",
    `- Karma: ${user.karma ?? 0}`,
    `- Account created: ${isoTime(user.created)}`,
    `- Submissions: ${user.submitted?.length ?? 0}`,
    `- Profile: ${links.user(user.id)}`,
  ];
  const about = stripHtml(user.about);
  if (about) lines.push("", "## About", "", about);
  return lines.join("\n");
}
