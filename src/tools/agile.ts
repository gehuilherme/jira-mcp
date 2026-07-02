import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { JiraClient } from "../jira-client.js";
import { toIssueSummary, type RawIssue } from "../types.js";
import { jsonResult, textResult } from "./_shared.js";

interface RawBoard {
  id: number;
  name: string;
  type: string;
  location?: { projectKey?: string; projectName?: string };
}

interface RawSprint {
  id: number;
  name: string;
  state: string;
  startDate?: string;
  endDate?: string;
  goal?: string;
}

const AGILE = "/rest/agile/1.0";

export function registerAgile(server: McpServer, client: JiraClient): void {
  server.registerTool(
    "list_boards",
    {
      title: "List boards (Agile)",
      description:
        "Lists Jira Agile boards (Scrum/Kanban). Filters by project, type and name.",
      inputSchema: {
        projectKeyOrId: z.string().optional().describe("Filter by project."),
        type: z.enum(["scrum", "kanban"]).optional(),
        name: z.string().optional().describe("Filter by part of the name."),
        maxResults: z.number().int().min(1).max(100).default(50),
      },
    },
    async ({ projectKeyOrId, type, name, maxResults }) => {
      const boards = await client.paginateClassic<RawBoard>(
        (startAt, ps) => {
          const qs = new URLSearchParams({
            startAt: String(startAt),
            maxResults: String(ps),
          });
          if (projectKeyOrId) qs.set("projectKeyOrId", projectKeyOrId);
          if (type) qs.set("type", type);
          if (name) qs.set("name", name);
          return `${AGILE}/board?${qs}`;
        },
        (page) => (page.values as RawBoard[]) ?? [],
        { maxItems: maxResults },
      );
      return jsonResult({
        count: boards.length,
        boards: boards.map((b) => ({
          id: b.id,
          name: b.name,
          type: b.type,
          project: b.location?.projectKey ?? null,
        })),
      });
    },
  );

  server.registerTool(
    "list_sprints",
    {
      title: "List sprints of a board",
      description:
        "Lists a board's sprints. `state` filters by active/future/closed.",
      inputSchema: {
        boardId: z.number().int().describe("Board id (see list_boards)."),
        state: z.enum(["active", "future", "closed"]).optional(),
        maxResults: z.number().int().min(1).max(100).default(50),
      },
    },
    async ({ boardId, state, maxResults }) => {
      const sprints = await client.paginateClassic<RawSprint>(
        (startAt, ps) => {
          const qs = new URLSearchParams({
            startAt: String(startAt),
            maxResults: String(ps),
          });
          if (state) qs.set("state", state);
          return `${AGILE}/board/${boardId}/sprint?${qs}`;
        },
        (page) => (page.values as RawSprint[]) ?? [],
        { maxItems: maxResults },
      );
      return jsonResult({
        count: sprints.length,
        sprints: sprints.map((s) => ({
          id: s.id,
          name: s.name,
          state: s.state,
          startDate: s.startDate ?? null,
          endDate: s.endDate ?? null,
          goal: s.goal ?? null,
        })),
      });
    },
  );

  server.registerTool(
    "sprint_issues",
    {
      title: "Issues of a sprint",
      description:
        "Lists a sprint's issues. `jql` filters additionally. Paginated.",
      inputSchema: {
        sprintId: z.number().int().describe("Sprint id (see list_sprints)."),
        jql: z.string().optional().describe("Additional JQL filter."),
        maxResults: z.number().int().min(1).max(100).default(50),
      },
    },
    async ({ sprintId, jql, maxResults }) => {
      const fields = ["summary", "status", "assignee", "priority", "updated"];
      const issues = await client.paginateClassic<RawIssue>(
        (startAt, ps) => {
          const qs = new URLSearchParams({
            startAt: String(startAt),
            maxResults: String(ps),
            fields: fields.join(","),
          });
          if (jql) qs.set("jql", jql);
          return `${AGILE}/sprint/${sprintId}/issue?${qs}`;
        },
        (page) => (page.issues as RawIssue[]) ?? [],
        { maxItems: maxResults },
      );
      return jsonResult({
        sprintId,
        count: issues.length,
        issues: issues.map(toIssueSummary),
      });
    },
  );

  server.registerTool(
    "move_issues_to_sprint",
    {
      title: "Move issues to a sprint (WRITE)",
      description:
        "Moves one or more issues to the given sprint (max 50 per call). " +
        "WRITE in Jira.",
      inputSchema: {
        sprintId: z.number().int().describe("Destination sprint id."),
        issues: z.array(z.string()).min(1).describe("Issue keys, e.g. ['PROJ-1']."),
      },
    },
    async ({ sprintId, issues }) => {
      await client.raw("POST", `${AGILE}/sprint/${sprintId}/issue`, { issues });
      return textResult(
        `OK — ${issues.length} issue(s) moved to sprint ${sprintId}.`,
      );
    },
  );

  server.registerTool(
    "move_issues_to_backlog",
    {
      title: "Move issues to the backlog (WRITE)",
      description:
        "Removes issues from sprints, moving them to the backlog (max 50). WRITE in Jira.",
      inputSchema: {
        issues: z.array(z.string()).min(1).describe("Issue keys."),
      },
    },
    async ({ issues }) => {
      await client.raw("POST", `${AGILE}/backlog/issue`, { issues });
      return textResult(
        `OK — ${issues.length} issue(s) moved to the backlog.`,
      );
    },
  );

  server.registerTool(
    "create_sprint",
    {
      title: "Create sprint (WRITE)",
      description:
        "Creates a new sprint in a Scrum board. WRITE in Jira.",
      inputSchema: {
        boardId: z.number().int().describe("Scrum board id."),
        name: z.string().min(1),
        startDate: z.string().optional().describe("ISO 8601, ex: 2026-07-01T09:00:00.000Z."),
        endDate: z.string().optional().describe("ISO 8601."),
        goal: z.string().optional(),
      },
    },
    async ({ boardId, name, startDate, endDate, goal }) => {
      const body: Record<string, unknown> = { originBoardId: boardId, name };
      if (startDate) body.startDate = startDate;
      if (endDate) body.endDate = endDate;
      if (goal) body.goal = goal;
      const res = await client.raw<{ id: number }>("POST", `${AGILE}/sprint`, body);
      return textResult(`OK — sprint "${name}" created (id ${res.id}).`);
    },
  );
}
