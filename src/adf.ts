/**
 * Conversão entre texto puro e o Atlassian Document Format (ADF), exigido pela
 * REST API v3 em campos ricos (description, comentários, worklogs).
 */

/** Extrai texto legível de um documento ADF. */
export function adfToText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const n = node as { type?: string; text?: string; content?: unknown[] };
  if (n.type === "text" && typeof n.text === "string") return n.text;
  const children = Array.isArray(n.content)
    ? n.content.map(adfToText).join("")
    : "";
  if (n.type === "paragraph" || n.type === "heading") return children + "\n";
  if (n.type === "hardBreak") return "\n";
  if (n.type === "listItem") return "- " + children;
  return children;
}

/** Converte texto puro em um documento ADF (quebras de linha viram parágrafos). */
export function textToAdf(text: string): unknown {
  const lines = text.split("\n");
  const content = lines.map((line) =>
    line.length
      ? { type: "paragraph", content: [{ type: "text", text: line }] }
      : { type: "paragraph" },
  );
  return { type: "doc", version: 1, content };
}

/**
 * Aceita string (→ ADF) ou um documento ADF já pronto (objeto). Usado por
 * create/edit/comment para permitir tanto texto simples quanto conteúdo rico.
 */
export function toAdf(input: string | object): unknown {
  return typeof input === "string" ? textToAdf(input) : input;
}
