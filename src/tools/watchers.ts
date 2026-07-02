import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { JiraClient } from "../jira-client.js";
import { jsonResult, textResult } from "./_shared.js";

export function registerWatchers(server: McpServer, client: JiraClient): void {
  server.registerTool(
    "list_watchers",
    {
      title: "List issue watchers",
      description: "Lists who is watching the issue (displayName + accountId).",
      inputSchema: { key: z.string().describe("Issue key, e.g. PROJ-123.") },
    },
    async ({ key }) => {
      const data = await client.raw<{
        watchCount?: number;
        watchers?: { displayName?: string; accountId?: string }[];
      }>("GET", `/rest/api/3/issue/${encodeURIComponent(key)}/watchers`);
      return jsonResult({
        count: data.watchCount ?? data.watchers?.length ?? 0,
        watchers: (data.watchers ?? []).map((w) => ({
          displayName: w.displayName ?? "",
          accountId: w.accountId ?? "",
        })),
      });
    },
  );

  server.registerTool(
    "add_watcher",
    {
      title: "Add watcher (WRITE)",
      description:
        "Adds a watcher to the issue. If `who` is omitted, adds yourself. " +
        "WRITE on Jira.",
      inputSchema: {
        key: z.string().describe("Issue key."),
        who: z
          .string()
          .optional()
          .describe("Email or accountId. Omitted = authenticated user."),
      },
    },
    async ({ key, who }) => {
      const accountId = who
        ? await client.resolveAccountId(who)
        : (await client.raw<{ accountId: string }>("GET", "/rest/api/3/myself"))
            .accountId;
      // The API expects the accountId as a JSON string in the body.
      await client.raw(
        "POST",
        `/rest/api/3/issue/${encodeURIComponent(key)}/watchers`,
        accountId,
      );
      return textResult(`OK — watcher ${accountId} added to ${key}.`);
    },
  );

  server.registerTool(
    "remove_watcher",
    {
      title: "Remove watcher (WRITE)",
      description: "Removes a watcher from the issue. WRITE on Jira.",
      inputSchema: {
        key: z.string().describe("Issue key."),
        who: z.string().describe("Email or accountId of the watcher to remove."),
      },
    },
    async ({ key, who }) => {
      const accountId = await client.resolveAccountId(who);
      await client.raw(
        "DELETE",
        `/rest/api/3/issue/${encodeURIComponent(key)}/watchers?accountId=${encodeURIComponent(accountId)}`,
      );
      return textResult(`OK — watcher ${accountId} removed from ${key}.`);
    },
  );
}
