import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { JiraClient } from "../jira-client.js";
import { adfToText, toAdf } from "../adf.js";
import type { RawComment } from "../types.js";
import { confirmGuard, jsonResult, textResult } from "./_shared.js";

export function registerComments(server: McpServer, client: JiraClient): void {
  server.registerTool(
    "list_comments",
    {
      title: "List comments",
      description:
        "Lists the comments of an issue with pagination (startAt/maxResults) and " +
        "optional ordering. Returns id, author, date and text.",
      inputSchema: {
        key: z.string().describe("Issue key, e.g. PROJ-123."),
        startAt: z.number().int().min(0).default(0),
        maxResults: z.number().int().min(1).max(100).default(50),
        orderBy: z
          .enum(["created", "-created"])
          .optional()
          .describe("created = oldest first; -created = newest first."),
      },
    },
    async ({ key, startAt, maxResults, orderBy }) => {
      const qs = new URLSearchParams({
        startAt: String(startAt),
        maxResults: String(maxResults),
      });
      if (orderBy) qs.set("orderBy", orderBy);
      const data = await client.raw<{
        comments?: RawComment[];
        total?: number;
      }>("GET", `/rest/api/3/issue/${encodeURIComponent(key)}/comment?${qs}`);
      const comments = (data.comments ?? []).map((c) => ({
        id: c.id ?? "",
        author: c.author?.displayName ?? "?",
        created: c.created ?? "",
        body: adfToText(c.body).trim(),
      }));
      return jsonResult({ total: data.total ?? comments.length, comments });
    },
  );

  server.registerTool(
    "add_comment",
    {
      title: "Add comment (WRITE)",
      description:
        "Adds a text comment to the issue (line breaks become " +
        "paragraphs). WRITE on Jira.",
      inputSchema: {
        key: z.string().describe("Issue key, e.g. PROJ-123."),
        body: z.string().min(1).describe("Comment text."),
      },
    },
    async ({ key, body }) => {
      const res = await client.raw<{ id: string }>(
        "POST",
        `/rest/api/3/issue/${encodeURIComponent(key)}/comment`,
        { body: toAdf(body) },
      );
      return textResult(
        `OK — comment added to ${key}${res?.id ? ` (id ${res.id})` : ""}.`,
      );
    },
  );

  server.registerTool(
    "edit_comment",
    {
      title: "Edit comment (WRITE)",
      description: "Replaces the text of an existing comment. WRITE on Jira.",
      inputSchema: {
        key: z.string().describe("Issue key."),
        commentId: z.string().describe("Comment id (see list_comments)."),
        body: z.string().min(1).describe("New text."),
      },
    },
    async ({ key, commentId, body }) => {
      await client.raw(
        "PUT",
        `/rest/api/3/issue/${encodeURIComponent(key)}/comment/${encodeURIComponent(commentId)}`,
        { body: toAdf(body) },
      );
      return textResult(`OK — comment ${commentId} of ${key} edited.`);
    },
  );

  server.registerTool(
    "delete_comment",
    {
      title: "Delete comment (DESTRUCTIVE)",
      description:
        "Deletes a comment. Requires `confirm: true` — without it, returns dry-run.",
      inputSchema: {
        key: z.string().describe("Issue key."),
        commentId: z.string().describe("Comment id."),
        confirm: z.boolean().optional(),
      },
    },
    async ({ key, commentId, confirm }) => {
      const guard = confirmGuard(
        confirm,
        `delete comment ${commentId} of ${key}`,
        { key, commentId },
      );
      if (guard) return guard;
      await client.raw(
        "DELETE",
        `/rest/api/3/issue/${encodeURIComponent(key)}/comment/${encodeURIComponent(commentId)}`,
      );
      return textResult(`OK — comment ${commentId} of ${key} deleted.`);
    },
  );
}
