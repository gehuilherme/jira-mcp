import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { JiraClient } from "../jira-client.js";
import { confirmGuard, jsonResult, textResult } from "./_shared.js";

interface RawAttachment {
  id: string;
  filename?: string;
  size?: number;
  mimeType?: string;
  created?: string;
  author?: { displayName?: string };
  content?: string;
}

export function registerAttachments(
  server: McpServer,
  client: JiraClient,
): void {
  server.registerTool(
    "list_attachments",
    {
      title: "List issue attachments",
      description:
        "Lists an issue's attachments (id, name, size, type, author, download URL).",
      inputSchema: { key: z.string().describe("Issue key, e.g. PROJ-123.") },
    },
    async ({ key }) => {
      const data = await client.raw<{
        fields?: { attachment?: RawAttachment[] };
      }>(
        "GET",
        `/rest/api/3/issue/${encodeURIComponent(key)}?fields=attachment`,
      );
      const list = data.fields?.attachment ?? [];
      return jsonResult({
        count: list.length,
        attachments: list.map((a) => ({
          id: a.id,
          filename: a.filename ?? "",
          size: a.size ?? 0,
          mimeType: a.mimeType ?? "",
          created: a.created ?? "",
          author: a.author?.displayName ?? "",
          content: a.content ?? "",
        })),
      });
    },
  );

  server.registerTool(
    "add_attachment",
    {
      title: "Attach local file (WRITE)",
      description:
        "Uploads a file from the local disk to the issue. `filePath` must be " +
        "an absolute path. WRITE in Jira (reads the local file).",
      inputSchema: {
        key: z.string().describe("Issue key."),
        filePath: z.string().describe("Absolute path of the file to attach."),
      },
    },
    async ({ key, filePath }) => {
      const res = await client.uploadAttachment(key, filePath);
      return textResult(
        `OK — attached to ${key}: ${res.map((a) => `${a.filename} (id ${a.id})`).join(", ")}.`,
      );
    },
  );

  server.registerTool(
    "delete_attachment",
    {
      title: "Delete attachment (DESTRUCTIVE)",
      description:
        "Deletes an attachment by its id (see list_attachments). Requires `confirm: true`.",
      inputSchema: {
        attachmentId: z.string().describe("Attachment id."),
        confirm: z.boolean().optional(),
      },
    },
    async ({ attachmentId, confirm }) => {
      const guard = confirmGuard(confirm, `delete attachment ${attachmentId}`, {
        attachmentId,
      });
      if (guard) return guard;
      await client.raw(
        "DELETE",
        `/rest/api/3/attachment/${encodeURIComponent(attachmentId)}`,
      );
      return textResult(`OK — attachment ${attachmentId} deleted.`);
    },
  );
}
