import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { JiraClient } from "../jira-client.js";
import { toAdf } from "../adf.js";
import { confirmGuard, jsonResult, textResult } from "./_shared.js";

export function registerLinks(server: McpServer, client: JiraClient): void {
  server.registerTool(
    "list_link_types",
    {
      title: "List issue link types",
      description:
        "Lists the available link types (id, name, and the inward/outward " +
        "descriptions, e.g. 'blocks' / 'is blocked by'). Use before link_issues.",
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
      title: "Link two issues (WRITE)",
      description:
        "Creates a link between two issues. `type` is the name (e.g. 'Blocks') or id of " +
        "the link type. Semantics: outward <type> inward (e.g. outward 'blocks' inward). " +
        "WRITE on Jira.",
      inputSchema: {
        outwardKey: z.string().describe("Source issue (e.g. the one that 'blocks')."),
        inwardKey: z.string().describe("Target issue (e.g. the one that 'is blocked by')."),
        type: z.string().describe("Link type name or id, e.g. 'Blocks'."),
        comment: z.string().optional().describe("Optional comment on the link."),
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
        `OK — link created: ${outwardKey} —[${type}]→ ${inwardKey}.`,
      );
    },
  );

  server.registerTool(
    "delete_link",
    {
      title: "Delete issue link (DESTRUCTIVE)",
      description:
        "Deletes a link by its id. Requires `confirm: true` — without it, dry-run. " +
        "The linkId appears in get_issue with fields=['issuelinks'].",
      inputSchema: {
        linkId: z.string().describe("Link id."),
        confirm: z.boolean().optional(),
      },
    },
    async ({ linkId, confirm }) => {
      const guard = confirmGuard(confirm, `delete link ${linkId}`, { linkId });
      if (guard) return guard;
      await client.raw(
        "DELETE",
        `/rest/api/3/issueLink/${encodeURIComponent(linkId)}`,
      );
      return textResult(`OK — link ${linkId} deleted.`);
    },
  );
}
