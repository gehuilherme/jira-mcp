/**
 * Builds a fully-wired McpServer for a given JiraClient.
 *
 * Extracted from the transport entrypoints so the SAME tool registration is
 * reused by every transport:
 *  - stdio: one client from the environment (single user);
 *  - http:  one client per request, built from the caller's headers.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { JiraClient } from "./jira-client.js";
import { registerIssues } from "./tools/issues.js";
import { registerSearch } from "./tools/search.js";
import { registerReports } from "./tools/reports.js";
import { registerComments } from "./tools/comments.js";
import { registerTransitions } from "./tools/transitions.js";
import { registerAssign } from "./tools/assign.js";
import { registerUsers } from "./tools/users.js";
import { registerWatchers } from "./tools/watchers.js";
import { registerLabelsComponents } from "./tools/labels-components.js";
import { registerLinks } from "./tools/links.js";
import { registerAttachments } from "./tools/attachments.js";
import { registerWorklogs } from "./tools/worklogs.js";
import { registerFields } from "./tools/fields.js";
import { registerProjects } from "./tools/projects.js";
import { registerAgile } from "./tools/agile.js";
import { registerGeneric } from "./tools/generic.js";

export function buildServer(client: JiraClient): McpServer {
  const server = new McpServer({
    name: "jira-mcp",
    version: "2.0.0",
  });

  // Issues, search and reports
  registerIssues(server, client);
  registerSearch(server, client);
  registerReports(server, client);
  // Workflow and people
  registerTransitions(server, client);
  registerAssign(server, client);
  registerUsers(server, client);
  registerComments(server, client);
  registerWatchers(server, client);
  // Metadata and organization
  registerFields(server, client);
  registerProjects(server, client);
  registerLabelsComponents(server, client);
  registerLinks(server, client);
  // Attachments and time
  registerAttachments(server, client);
  registerWorklogs(server, client);
  // Agile
  registerAgile(server, client);
  // Escape hatch
  registerGeneric(server, client);

  return server;
}
