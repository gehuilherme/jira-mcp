import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { JiraClient } from "../jira-client.js";
import { confirmGuard, errorResult, jsonResult } from "./_shared.js";

export function registerGeneric(server: McpServer, client: JiraClient): void {
  server.registerTool(
    "jira_request",
    {
      title: "Chamada REST genérica ao Jira (escape hatch)",
      description:
        "Executa qualquer chamada à API REST do Jira (v3 ou Agile 1.0) para casos " +
        "não cobertos pelas outras tools. `path` deve começar com `/rest/`. " +
        "GET é livre; métodos que escrevem (POST/PUT/DELETE) exigem `confirm: true` " +
        "— sem isso, retornam dry-run. Autenticação e retry são automáticos.",
      inputSchema: {
        method: z
          .enum(["GET", "POST", "PUT", "DELETE"])
          .describe("Método HTTP."),
        path: z
          .string()
          .describe("Caminho da API, ex: /rest/api/3/issue/PROJ-1 ou /rest/agile/1.0/board."),
        body: z
          .unknown()
          .optional()
          .describe("Corpo JSON (para POST/PUT)."),
        confirm: z
          .boolean()
          .optional()
          .describe("Obrigatório true para métodos não-GET."),
      },
    },
    async ({ method, path, body, confirm }) => {
      if (!path.startsWith("/rest/")) {
        return errorResult("`path` deve começar com /rest/ (ex: /rest/api/3/...).");
      }
      if (method !== "GET") {
        const guard = confirmGuard(confirm, `${method} ${path}`, { method, path, body });
        if (guard) return guard;
      }
      const data = await client.raw(method, path, body);
      return jsonResult(data ?? { ok: true, status: "sem corpo (204)" });
    },
  );
}
