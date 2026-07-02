import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { JiraClient } from "../jira-client.js";
import { adfToText, toAdf } from "../adf.js";
import type { RawIssue } from "../types.js";
import { confirmGuard, jsonResult, textResult } from "./_shared.js";

const DETAIL_FIELDS = [
  "summary",
  "status",
  "assignee",
  "reporter",
  "priority",
  "issuetype",
  "labels",
  "updated",
  "created",
  "description",
  "comment",
];

/** Builds `{id}` or `{name}` from a string (numeric = id). */
function idOrName(value: string): { id: string } | { name: string } {
  return /^\d+$/.test(value.trim()) ? { id: value.trim() } : { name: value.trim() };
}

/** Builds the API `fields` object from the standard params + custom fields. */
async function buildFields(
  client: JiraClient,
  input: {
    summary?: string;
    description?: string;
    assignee?: string;
    priority?: string;
    labels?: string[];
    customFields?: Record<string, unknown>;
  },
): Promise<Record<string, unknown>> {
  const fields: Record<string, unknown> = {};
  if (input.summary !== undefined) fields.summary = input.summary;
  if (input.description !== undefined)
    fields.description = toAdf(input.description);
  if (input.priority !== undefined) fields.priority = { name: input.priority };
  if (input.labels !== undefined) fields.labels = input.labels;
  if (input.assignee !== undefined) {
    fields.assignee = input.assignee
      ? { accountId: await client.resolveAccountId(input.assignee) }
      : null;
  }
  if (input.customFields && Object.keys(input.customFields).length) {
    Object.assign(fields, await client.resolveFields(input.customFields));
  }
  return fields;
}

export function registerIssues(server: McpServer, client: JiraClient): void {
  server.registerTool(
    "get_issue",
    {
      title: "Detail an issue",
      description:
        "Returns the details of an issue: summary, status, assignee, reporter, " +
        "priority, type, labels, description, recent comments and available " +
        "transitions. Pass `fields` to choose specific fields (includes custom).",
      inputSchema: {
        key: z.string().describe("Issue key, e.g. PROJ-123"),
        fields: z
          .array(z.string())
          .optional()
          .describe("Specific fields (name or id). If omitted, uses the default set."),
        expand: z
          .array(z.string())
          .optional()
          .describe("Expansions, e.g. ['renderedFields','changelog']."),
      },
    },
    async ({ key, fields, expand }) => {
      const reqFields = fields?.length ? fields : DETAIL_FIELDS;
      const qs = new URLSearchParams({ fields: reqFields.join(",") });
      if (expand?.length) qs.set("expand", expand.join(","));
      const [issue, transitions] = await Promise.all([
        client.raw<RawIssue>(
          "GET",
          `/rest/api/3/issue/${encodeURIComponent(key)}?${qs.toString()}`,
        ),
        client.getTransitions(key),
      ]);
      const f = issue.fields ?? {};
      const detail = {
        key: issue.key,
        summary: f.summary ?? "",
        status: f.status?.name ?? null,
        issueType: f.issuetype?.name ?? null,
        assignee: f.assignee?.displayName ?? null,
        reporter: f.reporter?.displayName ?? null,
        priority: f.priority?.name ?? null,
        labels: f.labels ?? [],
        created: f.created ?? null,
        updated: f.updated ?? null,
        description: f.description ? adfToText(f.description).trim() : "",
        comments: (f.comment?.comments ?? []).slice(-10).map((c) => ({
          id: c.id ?? "",
          author: c.author?.displayName ?? "?",
          created: c.created ?? "",
          body: adfToText(c.body).trim(),
        })),
        availableTransitions: transitions,
      };
      // Extra (custom) fields requested explicitly appear raw.
      if (fields?.length) {
        const extras: Record<string, unknown> = {};
        for (const key of fields)
          if (f[key] !== undefined) extras[key] = f[key];
        return jsonResult({ ...detail, raw: extras });
      }
      return jsonResult(detail);
    },
  );

  server.registerTool(
    "create_issue",
    {
      title: "Create issue (WRITE)",
      description:
        "Creates an issue in the project. `issueType` accepts a name (e.g. 'Task') or id. " +
        "`description` is plain text (becomes ADF). `customFields` maps by name OR " +
        "id (use list_fields/get_create_meta to discover). WRITE in Jira.",
      inputSchema: {
        projectKey: z
          .string()
          .optional()
          .describe("Project (default: JIRA_PROJECT_KEY)."),
        issueType: z.string().describe("Issue type: name (e.g. 'Task') or id."),
        summary: z.string().min(1).describe("Issue summary."),
        description: z.string().optional().describe("Description in plain text."),
        assignee: z.string().optional().describe("Email or accountId of the assignee."),
        priority: z.string().optional().describe("Priority name, e.g. 'High'."),
        labels: z.array(z.string()).optional(),
        parent: z
          .string()
          .optional()
          .describe("Parent key (for a subtask or an epic's issue)."),
        customFields: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("Custom fields by name or id."),
      },
    },
    async ({ projectKey, issueType, summary, description, assignee, priority, labels, parent, customFields }) => {
      const fields = await buildFields(client, {
        summary,
        description,
        assignee,
        priority,
        labels,
        customFields,
      });
      fields.project = { key: client.resolveProjectKey(projectKey) };
      fields.issuetype = idOrName(issueType);
      if (parent) fields.parent = { key: parent };
      const res = await client.raw<{ key: string; id: string }>(
        "POST",
        "/rest/api/3/issue",
        { fields },
      );
      return textResult(`OK — issue created: ${res.key} (id ${res.id}).`);
    },
  );

  server.registerTool(
    "create_subtask",
    {
      title: "Create subtask (WRITE)",
      description:
        "Shortcut to create a subtask linked to a parent issue. `issueType` " +
        "defaults to 'Sub-task' (adjust if your project uses another name). WRITE in Jira.",
      inputSchema: {
        parentKey: z.string().describe("Parent issue key, e.g. PROJ-123."),
        summary: z.string().min(1),
        description: z.string().optional(),
        issueType: z
          .string()
          .optional()
          .describe("Subtask type. If omitted, detects the project's subtask type."),
        projectKey: z.string().optional(),
      },
    },
    async ({ parentKey, summary, description, issueType, projectKey }) => {
      const pk = client.resolveProjectKey(projectKey);
      let typeRef: { id: string } | { name: string };
      if (issueType) {
        typeRef = idOrName(issueType);
      } else {
        const types = await client.paginateClassic<{ id: string; name: string; subtask?: boolean }>(
          (s, m) =>
            `/rest/api/3/issue/createmeta/${encodeURIComponent(pk)}/issuetypes?startAt=${s}&maxResults=${m}`,
          (page) => (page.issueTypes as { id: string; name: string; subtask?: boolean }[]) ?? [],
        );
        const st = types.find((t) => t.subtask);
        if (!st) {
          throw new Error(
            `Project ${pk} has no subtask type. Provide \`issueType\` explicitly.`,
          );
        }
        typeRef = { id: st.id };
      }
      const fields: Record<string, unknown> = {
        project: { key: pk },
        issuetype: typeRef,
        parent: { key: parentKey },
        summary,
      };
      if (description !== undefined) fields.description = toAdf(description);
      const res = await client.raw<{ key: string; id: string }>(
        "POST",
        "/rest/api/3/issue",
        { fields },
      );
      return textResult(`OK — subtask created: ${res.key} (parent ${parentKey}).`);
    },
  );

  server.registerTool(
    "edit_issue",
    {
      title: "Edit issue (WRITE)",
      description:
        "Updates fields of an issue. Only sends the provided fields. " +
        "`customFields` by name or id. WRITE in Jira.",
      inputSchema: {
        key: z.string().describe("Issue key, e.g. PROJ-123."),
        summary: z.string().optional(),
        description: z.string().optional(),
        assignee: z.string().optional().describe("Email/accountId; empty string unassigns."),
        priority: z.string().optional(),
        labels: z.array(z.string()).optional().describe("REPLACES all labels."),
        customFields: z.record(z.string(), z.unknown()).optional(),
        notifyUsers: z.boolean().default(true).describe("Notify watchers of the change."),
      },
    },
    async ({ key, summary, description, assignee, priority, labels, customFields, notifyUsers }) => {
      const fields = await buildFields(client, {
        summary,
        description,
        assignee,
        priority,
        labels,
        customFields,
      });
      if (!Object.keys(fields).length) {
        return textResult("Nothing to update — no fields provided.");
      }
      await client.raw(
        "PUT",
        `/rest/api/3/issue/${encodeURIComponent(key)}?notifyUsers=${notifyUsers}`,
        { fields },
      );
      return textResult(
        `OK — ${key} updated (${Object.keys(fields).join(", ")}).`,
      );
    },
  );

  server.registerTool(
    "delete_issue",
    {
      title: "Delete issue (DESTRUCTIVE)",
      description:
        "Deletes an issue permanently. Requires `confirm: true` — without it, " +
        "returns a dry-run. DESTRUCTIVE and irreversible.",
      inputSchema: {
        key: z.string().describe("Issue key, e.g. PROJ-123."),
        deleteSubtasks: z.boolean().default(false).describe("Delete subtasks too."),
        confirm: z.boolean().optional().describe("Pass true to execute."),
      },
    },
    async ({ key, deleteSubtasks, confirm }) => {
      const guard = confirmGuard(confirm, `delete issue ${key}`, {
        key,
        deleteSubtasks,
      });
      if (guard) return guard;
      await client.raw(
        "DELETE",
        `/rest/api/3/issue/${encodeURIComponent(key)}?deleteSubtasks=${deleteSubtasks}`,
      );
      return textResult(`OK — issue ${key} deleted.`);
    },
  );
}
