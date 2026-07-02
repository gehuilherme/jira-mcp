/**
 * Helpers compartilhados pelos módulos de tools: formatação de resposta MCP,
 * escape de JQL e o guard de confirmação para operações destrutivas.
 *
 * Observação: o McpServer já captura exceções lançadas dentro de um handler e
 * as devolve como `{ isError: true }`. Por isso as tools podem simplesmente
 * lançar `JiraError` (ou qualquer Error) em vez de montar o erro na mão.
 */

export interface ToolTextResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
  // O SDK do MCP tipa o retorno com index signature; espelhamos para compat.
  [key: string]: unknown;
}

/** Resposta de texto simples. */
export function textResult(text: string): ToolTextResult {
  return { content: [{ type: "text", text }] };
}

/** Resposta com um objeto serializado em JSON legível. */
export function jsonResult(data: unknown): ToolTextResult {
  return textResult(JSON.stringify(data, null, 2));
}

/** Resposta de erro explícita (para validações de lógica da própria tool). */
export function errorResult(text: string): ToolTextResult {
  return { isError: true, content: [{ type: "text", text }] };
}

/** Escapa aspas duplas para uso dentro de string entre aspas no JQL. */
export function jqlQuote(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

/**
 * Guard de operação destrutiva. Se `confirm` não for `true`, devolve um
 * resultado de DRY-RUN descrevendo a ação (sem executar). Se `confirm` for
 * `true`, devolve `null` e o caller segue com a execução real.
 */
export function confirmGuard(
  confirm: boolean | undefined,
  action: string,
  details?: unknown,
): ToolTextResult | null {
  if (confirm === true) return null;
  const body =
    `DRY-RUN — nada foi executado.\n` +
    `Ação pretendida: ${action}\n` +
    `Passe \`confirm: true\` para executar de verdade.` +
    (details !== undefined
      ? `\n\nDetalhes:\n${JSON.stringify(details, null, 2)}`
      : "");
  return textResult(body);
}
