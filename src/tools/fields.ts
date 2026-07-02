import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { JiraClient } from "../jira-client.js";
import { jsonResult } from "./_shared.js";

interface CreateMetaType {
  id: string;
  name: string;
  subtask?: boolean;
}

interface CreateMetaField {
  fieldId?: string;
  key?: string;
  name: string;
  required: boolean;
  schema?: { type?: string };
  allowedValues?: { id?: string; name?: string; value?: string }[];
}

export function registerFields(server: McpServer, client: JiraClient): void {
  server.registerTool(
    "list_fields",
    {
      title: "List Jira fields",
      description:
        "Lists all fields (id, name, whether it is custom, and the type). Use to " +
        "discover the id/name of a custom field before create/edit_issue. " +
        "`query` filters by part of the name.",
      inputSchema: {
        query: z.string().optional().describe("Filters by part of the field name."),
        customOnly: z.boolean().default(false).describe("Custom fields only."),
        refresh: z.boolean().default(false).describe("Ignore the cache and reload."),
      },
    },
    async ({ query, customOnly, refresh }) => {
      let fields = await client.listFields(refresh);
      if (customOnly) fields = fields.filter((f) => f.custom);
      if (query) {
        const q = query.toLowerCase();
        fields = fields.filter((f) => f.name.toLowerCase().includes(q));
      }
      return jsonResult({ count: fields.length, fields });
    },
  );

  server.registerTool(
    "get_create_meta",
    {
      title: "Create metadata (fields by type)",
      description:
        "Discovers a project's issue types and, if `issueType` is provided, " +
        "the available/required fields to create that type (includes custom fields and " +
        "allowed values). Basis for building `customFields` in create_issue.",
      inputSchema: {
        projectKey: z.string().optional().describe("Project (default: JIRA_PROJECT_KEY)."),
        issueType: z
          .string()
          .optional()
          .describe("Type name or id. If omitted, lists only the available types."),
      },
    },
    async ({ projectKey, issueType }) => {
      const pk = client.resolveProjectKey(projectKey);
      const types = await client.paginateClassic<CreateMetaType>(
        (startAt, maxResults) =>
          `/rest/api/3/issue/createmeta/${encodeURIComponent(pk)}/issuetypes?startAt=${startAt}&maxResults=${maxResults}`,
        (page) => (page.issueTypes as CreateMetaType[]) ?? [],
      );

      if (!issueType) {
        return jsonResult({
          project: pk,
          issueTypes: types.map((t) => ({
            id: t.id,
            name: t.name,
            subtask: t.subtask ?? false,
          })),
        });
      }

      const wanted = issueType.trim().toLowerCase();
      const type = types.find(
        (t) => t.id === issueType.trim() || t.name.toLowerCase() === wanted,
      );
      if (!type) {
        return jsonResult({
          error: `Type "${issueType}" not found in project ${pk}.`,
          issueTypes: types.map((t) => t.name),
        });
      }

      const fields = await client.paginateClassic<CreateMetaField>(
        (startAt, maxResults) =>
          `/rest/api/3/issue/createmeta/${encodeURIComponent(pk)}/issuetypes/${type.id}?startAt=${startAt}&maxResults=${maxResults}`,
        (page) => (page.fields as CreateMetaField[]) ?? [],
      );

      return jsonResult({
        project: pk,
        issueType: { id: type.id, name: type.name },
        fields: fields.map((f) => ({
          fieldId: f.fieldId ?? f.key,
          name: f.name,
          required: f.required,
          type: f.schema?.type ?? null,
          allowedValues: f.allowedValues
            ? f.allowedValues.map((v) => v.name ?? v.value ?? v.id)
            : undefined,
        })),
      });
    },
  );

  server.registerTool(
    "get_edit_meta",
    {
      title: "Edit metadata (editable fields)",
      description:
        "Lists the fields that can be edited on a specific issue and their options. " +
        "Useful before edit_issue when there are screen/custom fields.",
      inputSchema: {
        key: z.string().describe("Issue key, e.g. PROJ-123."),
      },
    },
    async ({ key }) => {
      const data = await client.raw<{ fields?: Record<string, unknown> }>(
        "GET",
        `/rest/api/3/issue/${encodeURIComponent(key)}/editmeta`,
      );
      return jsonResult(data.fields ?? {});
    },
  );
}
