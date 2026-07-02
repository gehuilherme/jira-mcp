import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { JiraClient } from "../jira-client.js";
import { jsonResult, textResult } from "./_shared.js";

export function registerWatchers(server: McpServer, client: JiraClient): void {
  server.registerTool(
    "list_watchers",
    {
      title: "Listar watchers da issue",
      description: "Lista quem está observando a issue (displayName + accountId).",
      inputSchema: { key: z.string().describe("Chave da issue, ex: PROJ-123.") },
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
      title: "Adicionar watcher (ESCRITA)",
      description:
        "Adiciona um watcher à issue. Se `who` for omitido, adiciona você mesmo. " +
        "ESCRITA no Jira.",
      inputSchema: {
        key: z.string().describe("Chave da issue."),
        who: z
          .string()
          .optional()
          .describe("E-mail ou accountId. Omitido = usuário autenticado."),
      },
    },
    async ({ key, who }) => {
      const accountId = who
        ? await client.resolveAccountId(who)
        : (await client.raw<{ accountId: string }>("GET", "/rest/api/3/myself"))
            .accountId;
      // A API espera o accountId como string JSON no corpo.
      await client.raw(
        "POST",
        `/rest/api/3/issue/${encodeURIComponent(key)}/watchers`,
        accountId,
      );
      return textResult(`OK — watcher ${accountId} adicionado em ${key}.`);
    },
  );

  server.registerTool(
    "remove_watcher",
    {
      title: "Remover watcher (ESCRITA)",
      description: "Remove um watcher da issue. ESCRITA no Jira.",
      inputSchema: {
        key: z.string().describe("Chave da issue."),
        who: z.string().describe("E-mail ou accountId do watcher a remover."),
      },
    },
    async ({ key, who }) => {
      const accountId = await client.resolveAccountId(who);
      await client.raw(
        "DELETE",
        `/rest/api/3/issue/${encodeURIComponent(key)}/watchers?accountId=${encodeURIComponent(accountId)}`,
      );
      return textResult(`OK — watcher ${accountId} removido de ${key}.`);
    },
  );
}
