import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { JiraClient } from "../jira-client.js";
import { adfToText, toAdf } from "../adf.js";
import type { RawComment } from "../types.js";
import { confirmGuard, jsonResult, textResult } from "./_shared.js";

export function registerComments(server: McpServer, client: JiraClient): void {
  server.registerTool(
    "list_comments",
    {
      title: "Listar comentários",
      description:
        "Lista os comentários de uma issue com paginação (startAt/maxResults) e " +
        "ordenação opcional. Retorna id, autor, data e texto.",
      inputSchema: {
        key: z.string().describe("Chave da issue, ex: PROJ-123."),
        startAt: z.number().int().min(0).default(0),
        maxResults: z.number().int().min(1).max(100).default(50),
        orderBy: z
          .enum(["created", "-created"])
          .optional()
          .describe("created = mais antigos primeiro; -created = mais novos primeiro."),
      },
    },
    async ({ key, startAt, maxResults, orderBy }) => {
      const qs = new URLSearchParams({
        startAt: String(startAt),
        maxResults: String(maxResults),
      });
      if (orderBy) qs.set("orderBy", orderBy);
      const data = await client.raw<{
        comments?: RawComment[];
        total?: number;
      }>("GET", `/rest/api/3/issue/${encodeURIComponent(key)}/comment?${qs}`);
      const comments = (data.comments ?? []).map((c) => ({
        id: c.id ?? "",
        author: c.author?.displayName ?? "?",
        created: c.created ?? "",
        body: adfToText(c.body).trim(),
      }));
      return jsonResult({ total: data.total ?? comments.length, comments });
    },
  );

  server.registerTool(
    "add_comment",
    {
      title: "Adicionar comentário (ESCRITA)",
      description:
        "Adiciona um comentário em texto na issue (quebras de linha viram " +
        "parágrafos). ESCRITA no Jira.",
      inputSchema: {
        key: z.string().describe("Chave da issue, ex: PROJ-123."),
        body: z.string().min(1).describe("Texto do comentário."),
      },
    },
    async ({ key, body }) => {
      const res = await client.raw<{ id: string }>(
        "POST",
        `/rest/api/3/issue/${encodeURIComponent(key)}/comment`,
        { body: toAdf(body) },
      );
      return textResult(
        `OK — comentário adicionado em ${key}${res?.id ? ` (id ${res.id})` : ""}.`,
      );
    },
  );

  server.registerTool(
    "edit_comment",
    {
      title: "Editar comentário (ESCRITA)",
      description: "Substitui o texto de um comentário existente. ESCRITA no Jira.",
      inputSchema: {
        key: z.string().describe("Chave da issue."),
        commentId: z.string().describe("Id do comentário (veja list_comments)."),
        body: z.string().min(1).describe("Novo texto."),
      },
    },
    async ({ key, commentId, body }) => {
      await client.raw(
        "PUT",
        `/rest/api/3/issue/${encodeURIComponent(key)}/comment/${encodeURIComponent(commentId)}`,
        { body: toAdf(body) },
      );
      return textResult(`OK — comentário ${commentId} de ${key} editado.`);
    },
  );

  server.registerTool(
    "delete_comment",
    {
      title: "Deletar comentário (DESTRUTIVA)",
      description:
        "Deleta um comentário. Exige `confirm: true` — sem isso, retorna dry-run.",
      inputSchema: {
        key: z.string().describe("Chave da issue."),
        commentId: z.string().describe("Id do comentário."),
        confirm: z.boolean().optional(),
      },
    },
    async ({ key, commentId, confirm }) => {
      const guard = confirmGuard(
        confirm,
        `deletar o comentário ${commentId} de ${key}`,
        { key, commentId },
      );
      if (guard) return guard;
      await client.raw(
        "DELETE",
        `/rest/api/3/issue/${encodeURIComponent(key)}/comment/${encodeURIComponent(commentId)}`,
      );
      return textResult(`OK — comentário ${commentId} de ${key} deletado.`);
    },
  );
}
