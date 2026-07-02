import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { JiraClient } from "../jira-client.js";
import { textResult } from "./_shared.js";

export function registerAssign(server: McpServer, client: JiraClient): void {
  server.registerTool(
    "assign_issue",
    {
      title: "Trocar responsável da issue (ESCRITA)",
      description:
        "Define ou remove o responsável de uma issue. Passe um e-mail ou accountId " +
        "para atribuir; passe vazio/omita `assignee` para DESATRIBUIR. ESCRITA no Jira.",
      inputSchema: {
        key: z.string().describe("Chave da issue, ex: PROJ-123"),
        assignee: z
          .string()
          .optional()
          .describe("E-mail ou accountId do novo responsável. Vazio/omitido = desatribuir."),
      },
    },
    async ({ key, assignee }) => {
      const raw = (assignee ?? "").trim();
      const accountId = raw ? await client.resolveAccountId(raw) : null;
      await client.raw(
        "PUT",
        `/rest/api/3/issue/${encodeURIComponent(key)}/assignee`,
        { accountId },
      );
      return textResult(
        accountId
          ? `OK — ${key} atribuído a accountId ${accountId}.`
          : `OK — ${key} ficou SEM responsável.`,
      );
    },
  );
}
