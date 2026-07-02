#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { JiraClient, loadConfig } from "./jira-client.js";
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

async function main(): Promise<void> {
  const client = new JiraClient(loadConfig());

  const server = new McpServer({
    name: "jira-mcp",
    version: "2.0.0",
  });

  // Issues, busca e relatórios
  registerIssues(server, client);
  registerSearch(server, client);
  registerReports(server, client);
  // Workflow e pessoas
  registerTransitions(server, client);
  registerAssign(server, client);
  registerUsers(server, client);
  registerComments(server, client);
  registerWatchers(server, client);
  // Metadados e organização
  registerFields(server, client);
  registerProjects(server, client);
  registerLabelsComponents(server, client);
  registerLinks(server, client);
  // Anexos e tempo
  registerAttachments(server, client);
  registerWorklogs(server, client);
  // Agile
  registerAgile(server, client);
  // Escape hatch
  registerGeneric(server, client);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr para não poluir o canal stdio do protocolo.
  console.error("jira-mcp server pronto (stdio).");
}

main().catch((err) => {
  console.error("Falha ao iniciar o jira-mcp:", err);
  process.exit(1);
});
