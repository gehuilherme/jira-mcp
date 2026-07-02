import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { JiraClient } from "../jira-client.js";
import { textResult } from "./_shared.js";

export function registerAssign(server: McpServer, client: JiraClient): void {
  server.registerTool(
    "assign_issue",
    {
      title: "Change issue assignee (WRITE)",
      description:
        "Sets or removes the assignee of an issue. Pass an email or accountId " +
        "to assign; pass empty/omit `assignee` to UNASSIGN. WRITE on Jira.",
      inputSchema: {
        key: z.string().describe("Issue key, e.g. PROJ-123"),
        assignee: z
          .string()
          .optional()
          .describe("Email or accountId of the new assignee. Empty/omitted = unassign."),
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
          ? `OK — ${key} assigned to accountId ${accountId}.`
          : `OK — ${key} is now UNASSIGNED.`,
      );
    },
  );
}
