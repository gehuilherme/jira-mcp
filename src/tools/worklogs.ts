import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { JiraClient } from "../jira-client.js";
import { adfToText, toAdf } from "../adf.js";
import { confirmGuard, jsonResult, textResult } from "./_shared.js";

interface RawWorklog {
  id?: string;
  author?: { displayName?: string };
  timeSpent?: string;
  timeSpentSeconds?: number;
  started?: string;
  comment?: unknown;
}

export function registerWorklogs(server: McpServer, client: JiraClient): void {
  server.registerTool(
    "list_worklogs",
    {
      title: "Listar apontamentos de horas",
      description:
        "Lista os worklogs (apontamentos de tempo) de uma issue: autor, tempo, " +
        "início e comentário. Paginado.",
      inputSchema: {
        key: z.string().describe("Chave da issue, ex: PROJ-123."),
        startAt: z.number().int().min(0).default(0),
        maxResults: z.number().int().min(1).max(100).default(50),
      },
    },
    async ({ key, startAt, maxResults }) => {
      const data = await client.raw<{ worklogs?: RawWorklog[]; total?: number }>(
        "GET",
        `/rest/api/3/issue/${encodeURIComponent(key)}/worklog?startAt=${startAt}&maxResults=${maxResults}`,
      );
      return jsonResult({
        total: data.total ?? data.worklogs?.length ?? 0,
        worklogs: (data.worklogs ?? []).map((w) => ({
          id: w.id ?? "",
          author: w.author?.displayName ?? "?",
          timeSpent: w.timeSpent ?? "",
          started: w.started ?? "",
          comment: w.comment ? adfToText(w.comment).trim() : "",
        })),
      });
    },
  );

  server.registerTool(
    "add_worklog",
    {
      title: "Apontar horas (ESCRITA)",
      description:
        "Registra tempo trabalhado numa issue. `timeSpent` ex: '2h', '30m', '1d 4h'. " +
        "ESCRITA no Jira.",
      inputSchema: {
        key: z.string().describe("Chave da issue."),
        timeSpent: z.string().describe("Tempo, ex: '2h', '1d', '90m'."),
        started: z
          .string()
          .optional()
          .describe("Início ISO 8601, ex: 2026-07-01T09:00:00.000+0000. Default: agora."),
        comment: z.string().optional().describe("Comentário do apontamento."),
        adjustEstimate: z
          .enum(["new", "leave", "manual", "auto"])
          .default("auto")
          .describe("Como ajustar a estimativa restante."),
      },
    },
    async ({ key, timeSpent, started, comment, adjustEstimate }) => {
      const body: Record<string, unknown> = { timeSpent };
      if (started) body.started = started;
      if (comment) body.comment = toAdf(comment);
      const res = await client.raw<{ id: string }>(
        "POST",
        `/rest/api/3/issue/${encodeURIComponent(key)}/worklog?adjustEstimate=${adjustEstimate}`,
        body,
      );
      return textResult(
        `OK — ${timeSpent} apontado em ${key}${res?.id ? ` (worklog ${res.id})` : ""}.`,
      );
    },
  );

  server.registerTool(
    "delete_worklog",
    {
      title: "Deletar apontamento (DESTRUTIVA)",
      description:
        "Deleta um worklog. Exige `confirm: true` — sem isso, dry-run.",
      inputSchema: {
        key: z.string().describe("Chave da issue."),
        worklogId: z.string().describe("Id do worklog (veja list_worklogs)."),
        confirm: z.boolean().optional(),
      },
    },
    async ({ key, worklogId, confirm }) => {
      const guard = confirmGuard(
        confirm,
        `deletar o worklog ${worklogId} de ${key}`,
        { key, worklogId },
      );
      if (guard) return guard;
      await client.raw(
        "DELETE",
        `/rest/api/3/issue/${encodeURIComponent(key)}/worklog/${encodeURIComponent(worklogId)}`,
      );
      return textResult(`OK — worklog ${worklogId} de ${key} deletado.`);
    },
  );
}
