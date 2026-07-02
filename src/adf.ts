/**
 * Conversion between plain text and the Atlassian Document Format (ADF), required
 * by the REST API v3 for rich fields (description, comments, worklogs).
 */

/** Extracts readable text from an ADF document. */
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

/** Converts plain text into an ADF document (line breaks become paragraphs). */
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
 * Accepts a string (→ ADF) or an already-built ADF document (object). Used by
 * create/edit/comment to allow both plain text and rich content.
 */
export function toAdf(input: string | object): unknown {
  return typeof input === "string" ? textToAdf(input) : input;
}
