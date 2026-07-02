import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { JiraClient } from "../jira-client.js";
import { jsonResult } from "./_shared.js";

interface RawProject {
  id: string;
  key: string;
  name: string;
  projectTypeKey?: string;
  lead?: { displayName?: string };
  issueTypes?: { id: string; name: string; subtask?: boolean }[];
}

export function registerProjects(server: McpServer, client: JiraClient): void {
  server.registerTool(
    "list_projects",
    {
      title: "List projects",
      description:
        "Lists/searches visible projects (id, key, name, type). `query` filters by " +
        "name or key. Paginated.",
      inputSchema: {
        query: z.string().optional().describe("Filters by project name or key."),
        maxResults: z.number().int().min(1).max(100).default(50),
      },
    },
    async ({ query, maxResults }) => {
      const projects = await client.paginateClassic<RawProject>(
        (startAt, ps) => {
          const qs = new URLSearchParams({
            startAt: String(startAt),
            maxResults: String(ps),
          });
          if (query) qs.set("query", query);
          return `/rest/api/3/project/search?${qs}`;
        },
        (page) => (page.values as RawProject[]) ?? [],
        { maxItems: maxResults },
      );
      return jsonResult({
        count: projects.length,
        projects: projects.map((p) => ({
          id: p.id,
          key: p.key,
          name: p.name,
          type: p.projectTypeKey ?? null,
        })),
      });
    },
  );

  server.registerTool(
    "get_project",
    {
      title: "Project details",
      description:
        "Returns details of a project including the available issue types. " +
        "Useful for discovering a valid issueType before create_issue.",
      inputSchema: {
        projectKey: z.string().optional().describe("Project (default: JIRA_PROJECT_KEY)."),
      },
    },
    async ({ projectKey }) => {
      const pk = client.resolveProjectKey(projectKey);
      const p = await client.raw<RawProject>(
        "GET",
        `/rest/api/3/project/${encodeURIComponent(pk)}`,
      );
      return jsonResult({
        id: p.id,
        key: p.key,
        name: p.name,
        type: p.projectTypeKey ?? null,
        lead: p.lead?.displayName ?? null,
        issueTypes: (p.issueTypes ?? []).map((t) => ({
          id: t.id,
          name: t.name,
          subtask: t.subtask ?? false,
        })),
      });
    },
  );
}
