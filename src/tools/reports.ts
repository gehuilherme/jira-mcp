import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { JiraClient } from "../jira-client.js";
import { toIssueSummary, type RawIssue } from "../types.js";
import { jqlQuote, jsonResult } from "./_shared.js";

type GroupBy =
  | "status"
  | "assignee"
  | "priority"
  | "label"
  | "issuetype"
  | "component";

/** Maps the grouping criterion to the API field and the key extractor. */
const GROUPERS: Record<
  GroupBy,
  { field: string; keys: (i: RawIssue) => string[] }
> = {
  status: { field: "status", keys: (i) => [i.fields?.status?.name ?? "—"] },
  assignee: {
    field: "assignee",
    keys: (i) => [i.fields?.assignee?.displayName ?? "No assignee"],
  },
  priority: {
    field: "priority",
    keys: (i) => [i.fields?.priority?.name ?? "—"],
  },
  issuetype: {
    field: "issuetype",
    keys: (i) => [i.fields?.issuetype?.name ?? "—"],
  },
  label: {
    field: "labels",
    keys: (i) => {
      const l = (i.fields?.labels as string[]) ?? [];
      return l.length ? l : ["(no label)"];
    },
  },
  component: {
    field: "components",
    keys: (i) => {
      const c = (i.fields?.components as { name?: string }[]) ?? [];
      return c.length ? c.map((x) => x.name ?? "—") : ["(no component)"];
    },
  },
};

export function registerReports(server: McpServer, client: JiraClient): void {
  server.registerTool(
    "count_issues",
    {
      title: "Count issues (JQL)",
      description:
        "Counts issues matching a JQL. By default uses Jira's approximate count " +
        "(fast). `exact: true` scans the pages to count exactly.",
      inputSchema: {
        jql: z.string().describe("JQL query."),
        exact: z.boolean().default(false).describe("Exact count (slower)."),
      },
    },
    async ({ jql, exact }) => {
      if (exact) {
        const issues = await client.paginateJqlSearch(jql, ["key"]);
        return jsonResult({ jql, count: issues.length, exact: true });
      }
      const data = await client.raw<{ count?: number }>(
        "POST",
        "/rest/api/3/search/approximate-count",
        { jql },
      );
      return jsonResult({ jql, count: data.count ?? 0, exact: false });
    },
  );

  server.registerTool(
    "group_issues",
    {
      title: "Group/count issues by field",
      description:
        "Groups and counts issues by status, assignee, priority, type, label or " +
        "component. Provide `jql` OR `projectKey`. Scans up to `maxIssues` issues.",
      inputSchema: {
        groupBy: z
          .enum(["status", "assignee", "priority", "label", "issuetype", "component"])
          .describe("Grouping criterion."),
        jql: z.string().optional().describe("Base JQL (takes priority over projectKey)."),
        projectKey: z.string().optional().describe("Project (if `jql` is omitted)."),
        maxIssues: z.number().int().min(1).max(5000).default(1000),
      },
    },
    async ({ groupBy, jql, projectKey, maxIssues }) => {
      const baseJql =
        jql ?? `project = ${jqlQuote(client.resolveProjectKey(projectKey))}`;
      const grouper = GROUPERS[groupBy as GroupBy];
      const issues = await client.paginateJqlSearch(baseJql, [grouper.field], {
        maxItems: maxIssues,
      });
      const counts = new Map<string, number>();
      for (const issue of issues) {
        for (const key of grouper.keys(issue)) {
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
      }
      const groups = [...counts.entries()]
        .map(([key, count]) => ({ key, count }))
        .sort((a, b) => b.count - a.count);
      return jsonResult({ jql: baseJql, groupBy, total: issues.length, groups });
    },
  );

  server.registerTool(
    "stale_issues",
    {
      title: "Issues stale for N days",
      description:
        "Lists issues not updated for at least N days (oldest first). " +
        "Optionally filters by project, status and assignee.",
      inputSchema: {
        days: z.number().int().min(1).describe("Number of days without update."),
        projectKey: z.string().optional(),
        status: z.string().optional().describe("Filters by exact status."),
        assignee: z
          .string()
          .optional()
          .describe("Email/accountId; use 'EMPTY' for no assignee."),
        maxResults: z.number().int().min(1).max(100).default(50),
      },
    },
    async ({ days, projectKey, status, assignee, maxResults }) => {
      const clauses = [`project = ${jqlQuote(client.resolveProjectKey(projectKey))}`];
      clauses.push(`updated <= -${days}d`);
      if (status) clauses.push(`status = ${jqlQuote(status)}`);
      if (assignee) {
        clauses.push(
          assignee.toUpperCase() === "EMPTY"
            ? "assignee is EMPTY"
            : `assignee = ${jqlQuote(await client.resolveAccountId(assignee))}`,
        );
      }
      const jql = `${clauses.join(" AND ")} ORDER BY updated ASC`;
      const page = await client.searchJqlPage(
        jql,
        ["summary", "status", "assignee", "priority", "updated"],
        maxResults,
      );
      const issues = (page.issues ?? []).map(toIssueSummary);
      return jsonResult({ jql, count: issues.length, issues });
    },
  );
}
