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
      title: "Buscar issues por JQL",
      description:
        "Executa uma busca JQL livre com paginação real. Retorna as issues, o " +
        "`nextPageToken` (passe-o de volta para a próxima página) e `isLast`. " +
        "Ex de JQL: `project = PROJ AND status = \"In Progress\" ORDER BY updated DESC`.",
      inputSchema: {
        jql: z.string().describe("Consulta JQL completa."),
        fields: z
          .array(z.string())
          .optional()
          .describe("Campos a retornar (nome ou id). Default: resumo/status/responsável/prioridade."),
        maxResults: z.number().int().min(1).max(100).default(50),
        nextPageToken: z
          .string()
          .optional()
          .describe("Token da página seguinte (retornado na chamada anterior)."),
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
