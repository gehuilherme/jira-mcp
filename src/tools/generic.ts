import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { JiraClient } from "../jira-client.js";
import { confirmGuard, errorResult, jsonResult } from "./_shared.js";

export function registerGeneric(server: McpServer, client: JiraClient): void {
  server.registerTool(
    "jira_request",
    {
      title: "Generic Jira REST call (escape hatch)",
      description:
        "Executes any Jira REST API call (v3 or Agile 1.0) for cases " +
        "not covered by the other tools. `path` must start with `/rest/`. " +
        "GET is free; writing methods (POST/PUT/DELETE) require `confirm: true` " +
        "— without it, they return dry-run. Authentication and retry are automatic.",
      inputSchema: {
        method: z
          .enum(["GET", "POST", "PUT", "DELETE"])
          .describe("HTTP method."),
        path: z
          .string()
          .describe("API path, e.g. /rest/api/3/issue/PROJ-1 or /rest/agile/1.0/board."),
        body: z
          .unknown()
          .optional()
          .describe("JSON body (for POST/PUT)."),
        confirm: z
          .boolean()
          .optional()
          .describe("Required true for non-GET methods."),
      },
    },
    async ({ method, path, body, confirm }) => {
      if (!path.startsWith("/rest/")) {
        return errorResult("`path` must start with /rest/ (e.g. /rest/api/3/...).");
      }
      if (method !== "GET") {
        const guard = confirmGuard(confirm, `${method} ${path}`, { method, path, body });
        if (guard) return guard;
      }
      const data = await client.raw(method, path, body);
      return jsonResult(data ?? { ok: true, status: "no body (204)" });
    },
  );
}
