import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { JiraClient } from "../jira-client.js";
import { toIssueSummary } from "../types.js";
import { jsonResult } from "./_shared.js";

const DEFAULT_FIELDS = ["summary", "status", "assignee", "priority", "updated"];

export function registerSearch(server: McpServer, client: JiraClient): void {
  server.registerTool(
    "search_issues",
    {
      title: "Search issues by JQL",
      description:
        "Runs a free-form JQL search with real pagination. Returns the issues, the " +
        "`nextPageToken` (pass it back for the next page) and `isLast`. " +
        "JQL example: `project = PROJ AND status = \"In Progress\" ORDER BY updated DESC`.",
      inputSchema: {
        jql: z.string().describe("Full JQL query."),
        fields: z
          .array(z.string())
          .optional()
          .describe("Fields to return (name or id). Default: summary/status/assignee/priority."),
        maxResults: z.number().int().min(1).max(100).default(50),
        nextPageToken: z
          .string()
          .optional()
          .describe("Token for the next page (returned by the previous call)."),
        expand: z.array(z.string()).optional(),
      },
    },
    async ({ jql, fields, maxResults, nextPageToken, expand }) => {
      const reqFields = fields?.length ? fields : DEFAULT_FIELDS;
      const page = await client.searchJqlPage(
        jql,
        reqFields,
        maxResults,
        nextPageToken,
        expand,
      );
      const issues = (page.issues ?? []).map((i) =>
        fields?.length ? { key: i.key, fields: i.fields } : toIssueSummary(i),
      );
      return jsonResult({
        jql,
        count: issues.length,
        isLast: page.isLast ?? !page.nextPageToken,
        nextPageToken: page.nextPageToken ?? null,
        issues,
      });
    },
  );
}
