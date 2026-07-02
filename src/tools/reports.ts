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

/** Mapeia o critério de agrupamento para o campo da API e o extrator de chaves. */
const GROUPERS: Record<
  GroupBy,
  { field: string; keys: (i: RawIssue) => string[] }
> = {
  status: { field: "status", keys: (i) => [i.fields?.status?.name ?? "—"] },
  assignee: {
    field: "assignee",
    keys: (i) => [i.fields?.assignee?.displayName ?? "Sem responsável"],
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
      return l.length ? l : ["(sem label)"];
    },
  },
  component: {
    field: "components",
    keys: (i) => {
      const c = (i.fields?.components as { name?: string }[]) ?? [];
      return c.length ? c.map((x) => x.name ?? "—") : ["(sem componente)"];
    },
  },
};

export function registerReports(server: McpServer, client: JiraClient): void {
  server.registerTool(
    "count_issues",
    {
      title: "Contar issues (JQL)",
      description:
        "Conta issues que batem com um JQL. Por padrão usa a contagem aproximada " +
        "do Jira (rápida). `exact: true` varre as páginas para contar exato.",
      inputSchema: {
        jql: z.string().describe("Consulta JQL."),
        exact: z.boolean().default(false).describe("Contagem exata (mais lenta)."),
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
      title: "Agrupar/contar issues por campo",
      description:
        "Agrupa e conta issues por status, responsável, prioridade, tipo, label ou " +
        "componente. Informe `jql` OU `projectKey`. Varre até `maxIssues` issues.",
      inputSchema: {
        groupBy: z
          .enum(["status", "assignee", "priority", "label", "issuetype", "component"])
          .describe("Critério de agrupamento."),
        jql: z.string().optional().describe("JQL base (tem prioridade sobre projectKey)."),
        projectKey: z.string().optional().describe("Projeto (se `jql` for omitido)."),
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
      title: "Issues paradas há N dias",
      description:
        "Lista issues não atualizadas há pelo menos N dias (mais antigas primeiro). " +
        "Filtra opcionalmente por projeto, status e responsável.",
      inputSchema: {
        days: z.number().int().min(1).describe("Nº de dias sem atualização."),
        projectKey: z.string().optional(),
        status: z.string().optional().describe("Filtra por status exato."),
        assignee: z
          .string()
          .optional()
          .describe("E-mail/accountId; use 'EMPTY' para sem responsável."),
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
