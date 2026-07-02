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
      title: "List status transitions",
      description:
        "Lists the workflow transitions available for an issue (id, name and " +
        "target status). Use before moving the status.",
      inputSchema: {
        key: z.string().describe("Issue key, e.g. PROJ-123"),
      },
    },
    async ({ key }) => jsonResult(await client.getTransitions(key)),
  );

  server.registerTool(
    "transition_issue",
    {
      title: "Move issue status (WRITE)",
      description:
        "Moves the issue to another status by executing a workflow transition. " +
        "Accepts the id OR the transition name (case-insensitive). Can include a " +
        "comment. WRITE on Jira.",
      inputSchema: {
        key: z.string().describe("Issue key, e.g. PROJ-123"),
        transition: z
          .string()
          .describe("Transition id (e.g. '21') or name (e.g. 'In Progress')"),
        comment: z
          .string()
          .optional()
          .describe("Optional comment added along with the transition."),
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
          `Transition "${transition}" is not valid for ${key}. ` +
            `Available: ${available
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
        `OK — ${key} moved via "${match.name}" (id ${match.id}) to status "${match.to}".`,
      );
    },
  );
}
