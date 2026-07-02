/**
 * Helpers shared across the tool modules: MCP response formatting,
 * JQL escaping and the confirmation guard for destructive operations.
 *
 * Note: the McpServer already catches exceptions thrown inside a handler and
 * returns them as `{ isError: true }`. That is why tools can simply throw
 * `JiraError` (or any Error) instead of building the error by hand.
 */

export interface ToolTextResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
  // The MCP SDK types the return with an index signature; we mirror it for compat.
  [key: string]: unknown;
}

/** Plain text response. */
export function textResult(text: string): ToolTextResult {
  return { content: [{ type: "text", text }] };
}

/** Response with an object serialized as readable JSON. */
export function jsonResult(data: unknown): ToolTextResult {
  return textResult(JSON.stringify(data, null, 2));
}

/** Explicit error response (for the tool's own logic validations). */
export function errorResult(text: string): ToolTextResult {
  return { isError: true, content: [{ type: "text", text }] };
}

/** Escapes double quotes for use inside a quoted string in JQL. */
export function jqlQuote(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

/**
 * Destructive operation guard. If `confirm` is not `true`, it returns a
 * DRY-RUN result describing the action (without executing). If `confirm` is
 * `true`, it returns `null` and the caller proceeds with the real execution.
 */
export function confirmGuard(
  confirm: boolean | undefined,
  action: string,
  details?: unknown,
): ToolTextResult | null {
  if (confirm === true) return null;
  const body =
    `DRY-RUN — nothing was executed.\n` +
    `Intended action: ${action}\n` +
    `Pass \`confirm: true\` to actually execute.` +
    (details !== undefined
      ? `\n\nDetails:\n${JSON.stringify(details, null, 2)}`
      : "");
  return textResult(body);
}
