import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { JiraClient } from "../jira-client.js";
import { toAdf } from "../adf.js";
import { confirmGuard, jsonResult, textResult } from "./_shared.js";

export function registerLinks(server: McpServer, client: JiraClient): void {
  server.registerTool(
    "list_link_types",
    {
      title: "Listar tipos de link entre issues",
      description:
        "Lista os tipos de vínculo disponíveis (id, nome e as descrições inward/" +
        "outward, ex: 'blocks' / 'is blocked by'). Use antes de link_issues.",
      inputSchema: {},
    },
    async () => {
      const data = await client.raw<{
        issueLinkTypes?: {
          id: string;
          name: string;
          inward: string;
          outward: string;
        }[];
      }>("GET", "/rest/api/3/issueLinkType");
      return jsonResult(data.issueLinkTypes ?? []);
    },
  );

  server.registerTool(
    "link_issues",
    {
      title: "Vincular duas issues (ESCRITA)",
      description:
        "Cria um vínculo entre duas issues. `type` é o nome (ex: 'Blocks') ou id do " +
        "tipo de link. Semântica: outward <type> inward (ex: outward 'blocks' inward). " +
        "ESCRITA no Jira.",
      inputSchema: {
        outwardKey: z.string().describe("Issue de origem (ex: a que 'blocks')."),
        inwardKey: z.string().describe("Issue de destino (ex: a que 'is blocked by')."),
        type: z.string().describe("Nome ou id do tipo de link, ex: 'Blocks'."),
        comment: z.string().optional().describe("Comentário opcional no vínculo."),
      },
    },
    async ({ outwardKey, inwardKey, type, comment }) => {
      const typeRef = /^\d+$/.test(type.trim())
        ? { id: type.trim() }
        : { name: type.trim() };
      const body: Record<string, unknown> = {
        type: typeRef,
        inwardIssue: { key: inwardKey },
        outwardIssue: { key: outwardKey },
      };
      if (comment) body.comment = { body: toAdf(comment) };
      await client.raw("POST", "/rest/api/3/issueLink", body);
      return textResult(
        `OK — vínculo criado: ${outwardKey} —[${type}]→ ${inwardKey}.`,
      );
    },
  );

  server.registerTool(
    "delete_link",
    {
      title: "Deletar vínculo entre issues (DESTRUTIVA)",
      description:
        "Deleta um vínculo pelo seu id. Exige `confirm: true` — sem isso, dry-run. " +
        "O linkId aparece em get_issue com fields=['issuelinks'].",
      inputSchema: {
        linkId: z.string().describe("Id do vínculo."),
        confirm: z.boolean().optional(),
      },
    },
    async ({ linkId, confirm }) => {
      const guard = confirmGuard(confirm, `deletar o vínculo ${linkId}`, { linkId });
      if (guard) return guard;
      await client.raw(
        "DELETE",
        `/rest/api/3/issueLink/${encodeURIComponent(linkId)}`,
      );
      return textResult(`OK — vínculo ${linkId} deletado.`);
    },
  );
}
