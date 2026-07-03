#!/usr/bin/env node
/**
 * Entrypoint. Selects the transport and delegates. Default is stdio (local,
 * single user) so existing setups keep working unchanged. HTTP (multi-user,
 * per-request credentials) is opt-in via `MCP_TRANSPORT=http` or `--http`.
 */
import { startStdio } from "./transports/stdio.js";
import { startHttp } from "./transports/http.js";

async function main(): Promise<void> {
  const useHttp =
    process.argv.includes("--http") ||
    (process.env.MCP_TRANSPORT ?? "stdio").trim().toLowerCase() === "http";

  if (useHttp) {
    await startHttp();
  } else {
    await startStdio();
  }
}

main().catch((err) => {
  console.error("Failed to start jira-mcp:", err);
  process.exit(1);
});
