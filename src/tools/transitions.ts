import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { JiraClient } from "../jira-client.js";
import { toAdf } from "../adf.js";
import { errorResult, jsonResult, textResult } from "./_shared.js";

export function registerTransitions(
  server: McpServer,
  client: JiraClient,
): void {
  server.registerTool(
    "list_transitions",
    {
      title: "Listar transições de status",
      description:
        "Lista as transições de workflow disponíveis para uma issue (id, nome e " +
        "status de destino). Use antes de mover o status.",
      inputSchema: {
        key: z.string().describe("Chave da issue, ex: PROJ-123"),
      },
    },
    async ({ key }) => jsonResult(await client.getTransitions(key)),
  );

  server.registerTool(
    "transition_issue",
    {
      title: "Mover status da issue (ESCRITA)",
      description:
        "Move a issue para outro status executando uma transição de workflow. " +
        "Aceita o id OU o nome da transição (case-insensitive). Pode incluir um " +
        "comentário. ESCRITA no Jira.",
      inputSchema: {
        key: z.string().describe("Chave da issue, ex: PROJ-123"),
        transition: z
          .string()
          .describe("Id da transição (ex: '21') ou nome (ex: 'In Progress')"),
        comment: z
          .string()
          .optional()
          .describe("Comentário opcional adicionado junto da transição."),
      },
    },
    async ({ key, transition, comment }) => {
      const available = await client.getTransitions(key);
      const wanted = transition.trim();
      const match =
        available.find((t) => t.id === wanted) ??
        available.find((t) => t.name.toLowerCase() === wanted.toLowerCase());

      if (!match) {
        return errorResult(
          `Transição "${transition}" não é válida para ${key}. ` +
            `Disponíveis: ${available
              .map((t) => `${t.name} (id ${t.id} → ${t.to})`)
              .join("; ")}`,
        );
      }

      const body: Record<string, unknown> = { transition: { id: match.id } };
      if (comment) {
        body.update = { comment: [{ add: { body: toAdf(comment) } }] };
      }
      await client.raw(
        "POST",
        `/rest/api/3/issue/${encodeURIComponent(key)}/transitions`,
        body,
      );
      return textResult(
        `OK — ${key} movido via "${match.name}" (id ${match.id}) para status "${match.to}".`,
      );
    },
  );
}
