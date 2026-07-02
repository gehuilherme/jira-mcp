import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { JiraClient } from "../jira-client.js";
import { jsonResult } from "./_shared.js";

export function registerUsers(server: McpServer, client: JiraClient): void {
  server.registerTool(
    "search_users",
    {
      title: "Buscar usuários do Jira",
      description:
        "Resolve nome ou e-mail para usuários do Jira, retornando displayName, " +
        "accountId, e-mail e se está ativo. Útil para descobrir o accountId antes " +
        "de reatribuir uma issue.",
      inputSchema: {
        query: z.string().describe("Parte do nome ou e-mail do usuário a procurar."),
        maxResults: z.number().int().min(1).max(50).default(20),
      },
    },
    async ({ query, maxResults }) =>
      jsonResult(await client.searchUsers(query, maxResults)),
  );

  server.registerTool(
    "get_current_user",
    {
      title: "Quem sou eu (usuário autenticado)",
      description:
        "Retorna o usuário autenticado (accountId, displayName, e-mail). Útil " +
        "para 'atribuir a mim' ou validar as credenciais configuradas.",
      inputSchema: {},
    },
    async () =>
      jsonResult(await client.raw("GET", "/rest/api/3/myself")),
  );
}
