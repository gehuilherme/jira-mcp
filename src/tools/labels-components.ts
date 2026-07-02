import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { JiraClient } from "../jira-client.js";
import { errorResult, jsonResult, textResult } from "./_shared.js";

export function registerLabelsComponents(
  server: McpServer,
  client: JiraClient,
): void {
  server.registerTool(
    "edit_labels",
    {
      title: "Add/remove labels (WRITE)",
      description:
        "Adds and/or removes labels on an issue without overwriting the others " +
        "(uses the update add/remove verbs). WRITE on Jira.",
      inputSchema: {
        key: z.string().describe("Issue key, e.g. PROJ-123."),
        add: z.array(z.string()).optional().describe("Labels to add."),
        remove: z.array(z.string()).optional().describe("Labels to remove."),
      },
    },
    async ({ key, add, remove }) => {
      const ops: { add?: string; remove?: string }[] = [
        ...(add ?? []).map((l) => ({ add: l })),
        ...(remove ?? []).map((l) => ({ remove: l })),
      ];
      if (!ops.length) return errorResult("Provide `add` and/or `remove`.");
      await client.raw("PUT", `/rest/api/3/issue/${encodeURIComponent(key)}`, {
        update: { labels: ops },
      });
      return textResult(
        `OK — labels of ${key} updated (+${add?.length ?? 0} / -${remove?.length ?? 0}).`,
      );
    },
  );

  server.registerTool(
    "list_components",
    {
      title: "List project components",
      description: "Lists a project's components (id + name).",
      inputSchema: {
        projectKey: z.string().optional().describe("Project (default: JIRA_PROJECT_KEY)."),
      },
    },
    async ({ projectKey }) => {
      const pk = client.resolveProjectKey(projectKey);
      const data = await client.raw<{ id: string; name: string }[]>(
        "GET",
        `/rest/api/3/project/${encodeURIComponent(pk)}/components`,
      );
      return jsonResult({
        project: pk,
        components: (data ?? []).map((c) => ({ id: c.id, name: c.name })),
      });
    },
  );

  server.registerTool(
    "set_components",
    {
      title: "Set issue components (WRITE)",
      description:
        "Replaces an issue's components. Accepts name or id (numeric = id). " +
        "Empty list removes all. WRITE on Jira.",
      inputSchema: {
        key: z.string().describe("Issue key."),
        components: z
          .array(z.string())
          .describe("Component names or ids (empty = remove all)."),
      },
    },
    async ({ key, components }) => {
      const value = components.map((c) =>
        /^\d+$/.test(c.trim()) ? { id: c.trim() } : { name: c.trim() },
      );
      await client.raw("PUT", `/rest/api/3/issue/${encodeURIComponent(key)}`, {
        fields: { components: value },
      });
      return textResult(`OK — components of ${key} set (${components.length}).`);
    },
  );
}
