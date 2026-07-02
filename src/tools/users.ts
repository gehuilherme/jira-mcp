import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { JiraClient } from "../jira-client.js";
import { jsonResult } from "./_shared.js";

export function registerUsers(server: McpServer, client: JiraClient): void {
  server.registerTool(
    "search_users",
    {
      title: "Search Jira users",
      description:
        "Resolves a name or email to Jira users, returning displayName, " +
        "accountId, email and whether they are active. Useful for finding the accountId before " +
        "reassigning an issue.",
      inputSchema: {
        query: z.string().describe("Part of the name or email of the user to search for."),
        maxResults: z.number().int().min(1).max(50).default(20),
      },
    },
    async ({ query, maxResults }) =>
      jsonResult(await client.searchUsers(query, maxResults)),
  );

  server.registerTool(
    "get_current_user",
    {
      title: "Who am I (authenticated user)",
      description:
        "Returns the authenticated user (accountId, displayName, email). Useful " +
        "for 'assign to me' or validating the configured credentials.",
      inputSchema: {},
    },
    async () =>
      jsonResult(await client.raw("GET", "/rest/api/3/myself")),
  );
}
