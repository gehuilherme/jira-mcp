import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { JiraClient } from "../jira-client.js";
import { adfToText, toAdf } from "../adf.js";
import type { RawIssue } from "../types.js";
import { confirmGuard, jsonResult, textResult } from "./_shared.js";

const DETAIL_FIELDS = [
  "summary",
  "status",
  "assignee",
  "reporter",
  "priority",
  "issuetype",
  "labels",
  "updated",
  "created",
  "description",
  "comment",
];

/** Monta `{id}` ou `{name}` a partir de uma string (numérica = id). */
function idOrName(value: string): { id: string } | { name: string } {
  return /^\d+$/.test(value.trim()) ? { id: value.trim() } : { name: value.trim() };
}

/** Constrói o objeto `fields` da API a partir dos params padrão + custom. */
async function buildFields(
  client: JiraClient,
  input: {
    summary?: string;
    description?: string;
    assignee?: string;
    priority?: string;
    labels?: string[];
    customFields?: Record<string, unknown>;
  },
): Promise<Record<string, unknown>> {
  const fields: Record<string, unknown> = {};
  if (input.summary !== undefined) fields.summary = input.summary;
  if (input.description !== undefined)
    fields.description = toAdf(input.description);
  if (input.priority !== undefined) fields.priority = { name: input.priority };
  if (input.labels !== undefined) fields.labels = input.labels;
  if (input.assignee !== undefined) {
    fields.assignee = input.assignee
      ? { accountId: await client.resolveAccountId(input.assignee) }
      : null;
  }
  if (input.customFields && Object.keys(input.customFields).length) {
    Object.assign(fields, await client.resolveFields(input.customFields));
  }
  return fields;
}

export function registerIssues(server: McpServer, client: JiraClient): void {
  server.registerTool(
    "get_issue",
    {
      title: "Detalhar uma issue",
      description:
        "Retorna os detalhes de uma issue: resumo, status, responsável, relator, " +
        "prioridade, tipo, labels, descrição, comentários recentes e transições " +
        "disponíveis. Passe `fields` para escolher campos específicos (inclui custom).",
      inputSchema: {
        key: z.string().describe("Chave da issue, ex: PROJ-123"),
        fields: z
          .array(z.string())
          .optional()
          .describe("Campos específicos (nome ou id). Se omitido, usa o conjunto padrão."),
        expand: z
          .array(z.string())
          .optional()
          .describe("Expansões, ex: ['renderedFields','changelog']."),
      },
    },
    async ({ key, fields, expand }) => {
      const reqFields = fields?.length ? fields : DETAIL_FIELDS;
      const qs = new URLSearchParams({ fields: reqFields.join(",") });
      if (expand?.length) qs.set("expand", expand.join(","));
      const [issue, transitions] = await Promise.all([
        client.raw<RawIssue>(
          "GET",
          `/rest/api/3/issue/${encodeURIComponent(key)}?${qs.toString()}`,
        ),
        client.getTransitions(key),
      ]);
      const f = issue.fields ?? {};
      const detail = {
        key: issue.key,
        summary: f.summary ?? "",
        status: f.status?.name ?? null,
        issueType: f.issuetype?.name ?? null,
        assignee: f.assignee?.displayName ?? null,
        reporter: f.reporter?.displayName ?? null,
        priority: f.priority?.name ?? null,
        labels: f.labels ?? [],
        created: f.created ?? null,
        updated: f.updated ?? null,
        description: f.description ? adfToText(f.description).trim() : "",
        comments: (f.comment?.comments ?? []).slice(-10).map((c) => ({
          id: c.id ?? "",
          author: c.author?.displayName ?? "?",
          created: c.created ?? "",
          body: adfToText(c.body).trim(),
        })),
        availableTransitions: transitions,
      };
      // Campos extras (custom) pedidos explicitamente aparecem crus.
      if (fields?.length) {
        const extras: Record<string, unknown> = {};
        for (const key of fields)
          if (f[key] !== undefined) extras[key] = f[key];
        return jsonResult({ ...detail, raw: extras });
      }
      return jsonResult(detail);
    },
  );

  server.registerTool(
    "create_issue",
    {
      title: "Criar issue (ESCRITA)",
      description:
        "Cria uma issue no projeto. `issueType` aceita nome (ex: 'Task') ou id. " +
        "`description` é texto puro (vira ADF). `customFields` mapeia por nome OU " +
        "id (use list_fields/get_create_meta para descobrir). ESCRITA no Jira.",
      inputSchema: {
        projectKey: z
          .string()
          .optional()
          .describe("Projeto (default: JIRA_PROJECT_KEY)."),
        issueType: z.string().describe("Tipo da issue: nome (ex: 'Task') ou id."),
        summary: z.string().min(1).describe("Título da issue."),
        description: z.string().optional().describe("Descrição em texto puro."),
        assignee: z.string().optional().describe("E-mail ou accountId do responsável."),
        priority: z.string().optional().describe("Nome da prioridade, ex: 'High'."),
        labels: z.array(z.string()).optional(),
        parent: z
          .string()
          .optional()
          .describe("Chave do pai (para subtask ou issue de epic)."),
        customFields: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("Campos customizados por nome ou id."),
      },
    },
    async ({ projectKey, issueType, summary, description, assignee, priority, labels, parent, customFields }) => {
      const fields = await buildFields(client, {
        summary,
        description,
        assignee,
        priority,
        labels,
        customFields,
      });
      fields.project = { key: client.resolveProjectKey(projectKey) };
      fields.issuetype = idOrName(issueType);
      if (parent) fields.parent = { key: parent };
      const res = await client.raw<{ key: string; id: string }>(
        "POST",
        "/rest/api/3/issue",
        { fields },
      );
      return textResult(`OK — issue criada: ${res.key} (id ${res.id}).`);
    },
  );

  server.registerTool(
    "create_subtask",
    {
      title: "Criar subtask (ESCRITA)",
      description:
        "Atalho para criar uma subtask vinculada a uma issue pai. `issueType` " +
        "default 'Sub-task' (ajuste se seu projeto usa outro nome). ESCRITA no Jira.",
      inputSchema: {
        parentKey: z.string().describe("Chave da issue pai, ex: PROJ-123."),
        summary: z.string().min(1),
        description: z.string().optional(),
        issueType: z
          .string()
          .optional()
          .describe("Tipo de subtask. Se omitido, detecta o tipo subtask do projeto."),
        projectKey: z.string().optional(),
      },
    },
    async ({ parentKey, summary, description, issueType, projectKey }) => {
      const pk = client.resolveProjectKey(projectKey);
      let typeRef: { id: string } | { name: string };
      if (issueType) {
        typeRef = idOrName(issueType);
      } else {
        const types = await client.paginateClassic<{ id: string; name: string; subtask?: boolean }>(
          (s, m) =>
            `/rest/api/3/issue/createmeta/${encodeURIComponent(pk)}/issuetypes?startAt=${s}&maxResults=${m}`,
          (page) => (page.issueTypes as { id: string; name: string; subtask?: boolean }[]) ?? [],
        );
        const st = types.find((t) => t.subtask);
        if (!st) {
          throw new Error(
            `Projeto ${pk} não tem tipo de subtask. Informe \`issueType\` explicitamente.`,
          );
        }
        typeRef = { id: st.id };
      }
      const fields: Record<string, unknown> = {
        project: { key: pk },
        issuetype: typeRef,
        parent: { key: parentKey },
        summary,
      };
      if (description !== undefined) fields.description = toAdf(description);
      const res = await client.raw<{ key: string; id: string }>(
        "POST",
        "/rest/api/3/issue",
        { fields },
      );
      return textResult(`OK — subtask criada: ${res.key} (pai ${parentKey}).`);
    },
  );

  server.registerTool(
    "edit_issue",
    {
      title: "Editar issue (ESCRITA)",
      description:
        "Atualiza campos de uma issue. Só envia os campos informados. " +
        "`customFields` por nome ou id. ESCRITA no Jira.",
      inputSchema: {
        key: z.string().describe("Chave da issue, ex: PROJ-123."),
        summary: z.string().optional(),
        description: z.string().optional(),
        assignee: z.string().optional().describe("E-mail/accountId; string vazia desatribui."),
        priority: z.string().optional(),
        labels: z.array(z.string()).optional().describe("SUBSTITUI todas as labels."),
        customFields: z.record(z.string(), z.unknown()).optional(),
        notifyUsers: z.boolean().default(true).describe("Notificar watchers da mudança."),
      },
    },
    async ({ key, summary, description, assignee, priority, labels, customFields, notifyUsers }) => {
      const fields = await buildFields(client, {
        summary,
        description,
        assignee,
        priority,
        labels,
        customFields,
      });
      if (!Object.keys(fields).length) {
        return textResult("Nada para atualizar — nenhum campo informado.");
      }
      await client.raw(
        "PUT",
        `/rest/api/3/issue/${encodeURIComponent(key)}?notifyUsers=${notifyUsers}`,
        { fields },
      );
      return textResult(
        `OK — ${key} atualizado (${Object.keys(fields).join(", ")}).`,
      );
    },
  );

  server.registerTool(
    "delete_issue",
    {
      title: "Deletar issue (DESTRUTIVA)",
      description:
        "Deleta uma issue permanentemente. Exige `confirm: true` — sem isso, " +
        "retorna um dry-run. DESTRUTIVA e irreversível.",
      inputSchema: {
        key: z.string().describe("Chave da issue, ex: PROJ-123."),
        deleteSubtasks: z.boolean().default(false).describe("Deletar subtasks junto."),
        confirm: z.boolean().optional().describe("Passe true para executar."),
      },
    },
    async ({ key, deleteSubtasks, confirm }) => {
      const guard = confirmGuard(confirm, `deletar a issue ${key}`, {
        key,
        deleteSubtasks,
      });
      if (guard) return guard;
      await client.raw(
        "DELETE",
        `/rest/api/3/issue/${encodeURIComponent(key)}?deleteSubtasks=${deleteSubtasks}`,
      );
      return textResult(`OK — issue ${key} deletada.`);
    },
  );
}
