import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { JiraClient } from "../jira-client.js";
import { errorResult, jsonResult, textResult } from "./_shared.js";

export function registerLabelsComponents(
  server: McpServer,
  client: JiraClient,
): void {
  server.registerTool(
    "edit_labels",
    {
      title: "Adicionar/remover labels (ESCRITA)",
      description:
        "Adiciona e/ou remove labels de uma issue sem sobrescrever as demais " +
        "(usa os verbos add/remove do update). ESCRITA no Jira.",
      inputSchema: {
        key: z.string().describe("Chave da issue, ex: PROJ-123."),
        add: z.array(z.string()).optional().describe("Labels a adicionar."),
        remove: z.array(z.string()).optional().describe("Labels a remover."),
      },
    },
    async ({ key, add, remove }) => {
      const ops: { add?: string; remove?: string }[] = [
        ...(add ?? []).map((l) => ({ add: l })),
        ...(remove ?? []).map((l) => ({ remove: l })),
      ];
      if (!ops.length) return errorResult("Informe `add` e/ou `remove`.");
      await client.raw("PUT", `/rest/api/3/issue/${encodeURIComponent(key)}`, {
        update: { labels: ops },
      });
      return textResult(
        `OK — labels de ${key} atualizadas (+${add?.length ?? 0} / -${remove?.length ?? 0}).`,
      );
    },
  );

  server.registerTool(
    "list_components",
    {
      title: "Listar componentes do projeto",
      description: "Lista os componentes de um projeto (id + nome).",
      inputSchema: {
        projectKey: z.string().optional().describe("Projeto (default: JIRA_PROJECT_KEY)."),
      },
    },
    async ({ projectKey }) => {
      const pk = client.resolveProjectKey(projectKey);
      const data = await client.raw<{ id: string; name: string }[]>(
        "GET",
        `/rest/api/3/project/${encodeURIComponent(pk)}/components`,
      );
      return jsonResult({
        project: pk,
        components: (data ?? []).map((c) => ({ id: c.id, name: c.name })),
      });
    },
  );

  server.registerTool(
    "set_components",
    {
      title: "Definir componentes da issue (ESCRITA)",
      description:
        "Substitui os componentes de uma issue. Aceita nome ou id (numérico = id). " +
        "Lista vazia remove todos. ESCRITA no Jira.",
      inputSchema: {
        key: z.string().describe("Chave da issue."),
        components: z
          .array(z.string())
          .describe("Nomes ou ids dos componentes (vazio = remover todos)."),
      },
    },
    async ({ key, components }) => {
      const value = components.map((c) =>
        /^\d+$/.test(c.trim()) ? { id: c.trim() } : { name: c.trim() },
      );
      await client.raw("PUT", `/rest/api/3/issue/${encodeURIComponent(key)}`, {
        fields: { components: value },
      });
      return textResult(`OK — componentes de ${key} definidos (${components.length}).`);
    },
  );
}
