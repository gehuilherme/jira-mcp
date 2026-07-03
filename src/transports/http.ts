/**
 * HTTP transport — multi-user. A plain Node HTTP server exposes the MCP
 * endpoint at `/mcp`. It is STATELESS: every POST carries the caller's own
 * Jira credentials in headers, so we build a fresh JiraClient + McpServer per
 * request and tear them down when the response closes. No session state, no
 * stored secrets.
 *
 * Security assumptions (see README "Deploying on Debian"):
 *  - TLS is terminated by an upstream proxy; this server speaks plain HTTP and
 *    must only be reachable by that proxy (bind to an internal IP + firewall).
 *  - Credential headers are NEVER logged.
 */
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  JiraClient,
  MissingCredentialsError,
  configFromHeaders,
} from "../jira-client.js";
import { buildServer } from "../server-factory.js";

const MCP_PATH = "/mcp";
const MAX_BODY_BYTES = 4 * 1024 * 1024; // 4 MiB guard

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve(undefined);
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new SyntaxError("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function sendError(
  res: ServerResponse,
  status: number,
  code: number,
  message: string,
): void {
  if (res.headersSent) return;
  const payload = JSON.stringify({
    jsonrpc: "2.0",
    error: { code, message },
    id: null,
  });
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(payload);
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");

  // Lightweight liveness probe for the proxy / systemd.
  if (req.method === "GET" && url.pathname === "/healthz") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
    return;
  }

  if (url.pathname !== MCP_PATH) {
    sendError(res, 404, -32601, "Not found");
    return;
  }

  // Stateless mode has no SSE stream / session, so only POST is meaningful.
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    sendError(res, 405, -32601, "Method not allowed; use POST");
    return;
  }

  // Build the per-request client from headers. On missing creds -> 401.
  // NEVER log req.headers: they carry the caller's Jira token.
  let client: JiraClient;
  try {
    client = new JiraClient(configFromHeaders(req.headers));
  } catch (err) {
    if (err instanceof MissingCredentialsError) {
      sendError(res, 401, -32001, err.message);
      return;
    }
    throw err;
  }

  let body: unknown;
  try {
    body = await readBody(req);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Parse error";
    sendError(res, 400, -32700, message);
    return;
  }

  const server = buildServer(client);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}

export async function startHttp(): Promise<void> {
  const host = (process.env.HTTP_HOST ?? "127.0.0.1").trim();
  const port = Number.parseInt(process.env.HTTP_PORT ?? "3000", 10);

  const httpServer = createServer((req, res) => {
    handle(req, res).catch((err) => {
      // Log the shape of the failure, never the request headers/body.
      console.error(
        "jira-mcp http handler error:",
        err instanceof Error ? err.message : err,
      );
      sendError(res, 500, -32603, "Internal server error");
    });
  });

  await new Promise<void>((resolve) => {
    httpServer.listen(port, host, () => {
      console.error(
        `jira-mcp server ready (http) on http://${host}:${port}${MCP_PATH}`,
      );
      resolve();
    });
  });
}
