import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { JiraClient } from "../jira-client.js";
import { confirmGuard, jsonResult, textResult } from "./_shared.js";

interface RawAttachment {
  id: string;
  filename?: string;
  size?: number;
  mimeType?: string;
  created?: string;
  author?: { displayName?: string };
  content?: string;
}

export function registerAttachments(
  server: McpServer,
  client: JiraClient,
): void {
  server.registerTool(
    "list_attachments",
    {
      title: "Listar anexos da issue",
      description:
        "Lista os anexos de uma issue (id, nome, tamanho, tipo, autor, URL de download).",
      inputSchema: { key: z.string().describe("Chave da issue, ex: PROJ-123.") },
    },
    async ({ key }) => {
      const data = await client.raw<{
        fields?: { attachment?: RawAttachment[] };
      }>(
        "GET",
        `/rest/api/3/issue/${encodeURIComponent(key)}?fields=attachment`,
      );
      const list = data.fields?.attachment ?? [];
      return jsonResult({
        count: list.length,
        attachments: list.map((a) => ({
          id: a.id,
          filename: a.filename ?? "",
          size: a.size ?? 0,
          mimeType: a.mimeType ?? "",
          created: a.created ?? "",
          author: a.author?.displayName ?? "",
          content: a.content ?? "",
        })),
      });
    },
  );

  server.registerTool(
    "add_attachment",
    {
      title: "Anexar arquivo local (ESCRITA)",
      description:
        "Faz upload de um arquivo do disco local para a issue. `filePath` deve ser " +
        "um caminho absoluto. ESCRITA no Jira (lê o arquivo local).",
      inputSchema: {
        key: z.string().describe("Chave da issue."),
        filePath: z.string().describe("Caminho absoluto do arquivo a anexar."),
      },
    },
    async ({ key, filePath }) => {
      const res = await client.uploadAttachment(key, filePath);
      return textResult(
        `OK — anexado em ${key}: ${res.map((a) => `${a.filename} (id ${a.id})`).join(", ")}.`,
      );
    },
  );

  server.registerTool(
    "delete_attachment",
    {
      title: "Deletar anexo (DESTRUTIVA)",
      description:
        "Deleta um anexo pelo seu id (veja list_attachments). Exige `confirm: true`.",
      inputSchema: {
        attachmentId: z.string().describe("Id do anexo."),
        confirm: z.boolean().optional(),
      },
    },
    async ({ attachmentId, confirm }) => {
      const guard = confirmGuard(confirm, `deletar o anexo ${attachmentId}`, {
        attachmentId,
      });
      if (guard) return guard;
      await client.raw(
        "DELETE",
        `/rest/api/3/attachment/${encodeURIComponent(attachmentId)}`,
      );
      return textResult(`OK — anexo ${attachmentId} deletado.`);
    },
  );
}
