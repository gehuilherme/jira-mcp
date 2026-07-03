/**
 * stdio transport — one process, one user. Credentials come from the
 * environment (`.env` / process env), exactly as before the HTTP transport
 * existed. This is the default when MCP_TRANSPORT is unset.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { JiraClient, loadConfig } from "../jira-client.js";
import { buildServer } from "../server-factory.js";

export async function startStdio(): Promise<void> {
  const client = new JiraClient(loadConfig());
  const server = buildServer(client);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr so as not to pollute the protocol's stdio channel.
  console.error("jira-mcp server ready (stdio).");
}
