import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { JiraClient } from "../jira-client.js";
import { jsonResult } from "./_shared.js";

interface CreateMetaType {
  id: string;
  name: string;
  subtask?: boolean;
}

interface CreateMetaField {
  fieldId?: string;
  key?: string;
  name: string;
  required: boolean;
  schema?: { type?: string };
  allowedValues?: { id?: string; name?: string; value?: string }[];
}

export function registerFields(server: McpServer, client: JiraClient): void {
  server.registerTool(
    "list_fields",
    {
      title: "Listar campos do Jira",
      description:
        "Lista todos os campos (id, nome, se é customizado e o tipo). Use para " +
        "descobrir o id/nome de um campo customizado antes de create/edit_issue. " +
        "`query` filtra por parte do nome.",
      inputSchema: {
        query: z.string().optional().describe("Filtra por parte do nome do campo."),
        customOnly: z.boolean().default(false).describe("Só campos customizados."),
        refresh: z.boolean().default(false).describe("Ignora o cache e recarrega."),
      },
    },
    async ({ query, customOnly, refresh }) => {
      let fields = await client.listFields(refresh);
      if (customOnly) fields = fields.filter((f) => f.custom);
      if (query) {
        const q = query.toLowerCase();
        fields = fields.filter((f) => f.name.toLowerCase().includes(q));
      }
      return jsonResult({ count: fields.length, fields });
    },
  );

  server.registerTool(
    "get_create_meta",
    {
      title: "Metadados de criação (campos por tipo)",
      description:
        "Descobre os tipos de issue de um projeto e, se `issueType` for informado, " +
        "os campos disponíveis/obrigatórios para criar aquele tipo (inclui custom e " +
        "valores permitidos). Base para montar `customFields` em create_issue.",
      inputSchema: {
        projectKey: z.string().optional().describe("Projeto (default: JIRA_PROJECT_KEY)."),
        issueType: z
          .string()
          .optional()
          .describe("Nome ou id do tipo. Se omitido, lista só os tipos disponíveis."),
      },
    },
    async ({ projectKey, issueType }) => {
      const pk = client.resolveProjectKey(projectKey);
      const types = await client.paginateClassic<CreateMetaType>(
        (startAt, maxResults) =>
          `/rest/api/3/issue/createmeta/${encodeURIComponent(pk)}/issuetypes?startAt=${startAt}&maxResults=${maxResults}`,
        (page) => (page.issueTypes as CreateMetaType[]) ?? [],
      );

      if (!issueType) {
        return jsonResult({
          project: pk,
          issueTypes: types.map((t) => ({
            id: t.id,
            name: t.name,
            subtask: t.subtask ?? false,
          })),
        });
      }

      const wanted = issueType.trim().toLowerCase();
      const type = types.find(
        (t) => t.id === issueType.trim() || t.name.toLowerCase() === wanted,
      );
      if (!type) {
        return jsonResult({
          error: `Tipo "${issueType}" não encontrado no projeto ${pk}.`,
          issueTypes: types.map((t) => t.name),
        });
      }

      const fields = await client.paginateClassic<CreateMetaField>(
        (startAt, maxResults) =>
          `/rest/api/3/issue/createmeta/${encodeURIComponent(pk)}/issuetypes/${type.id}?startAt=${startAt}&maxResults=${maxResults}`,
        (page) => (page.fields as CreateMetaField[]) ?? [],
      );

      return jsonResult({
        project: pk,
        issueType: { id: type.id, name: type.name },
        fields: fields.map((f) => ({
          fieldId: f.fieldId ?? f.key,
          name: f.name,
          required: f.required,
          type: f.schema?.type ?? null,
          allowedValues: f.allowedValues
            ? f.allowedValues.map((v) => v.name ?? v.value ?? v.id)
            : undefined,
        })),
      });
    },
  );

  server.registerTool(
    "get_edit_meta",
    {
      title: "Metadados de edição (campos editáveis)",
      description:
        "Lista os campos que podem ser editados numa issue específica e suas opções. " +
        "Útil antes de edit_issue quando há campos de tela/customizados.",
      inputSchema: {
        key: z.string().describe("Chave da issue, ex: PROJ-123."),
      },
    },
    async ({ key }) => {
      const data = await client.raw<{ fields?: Record<string, unknown> }>(
        "GET",
        `/rest/api/3/issue/${encodeURIComponent(key)}/editmeta`,
      );
      return jsonResult(data.fields ?? {});
    },
  );
}
