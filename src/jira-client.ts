/**
 * Wrapper sobre a Jira Cloud REST API v3 + Agile 1.0 usando o `fetch` nativo do
 * Node. Sem dependências de terceiros — auth Basic com base64(email:api_token).
 *
 * Responsabilidades desta classe (infra reutilizável):
 *  - request/raw com retry de 429/5xx e erros normalizados (JiraError);
 *  - paginação (clássica startAt/total e a nova de JQL nextPageToken/isLast);
 *  - resolução de campos customizados por nome→id e de usuários por e-mail;
 *  - upload multipart de anexos.
 * A lógica específica de cada endpoint fica nos módulos de `tools/`, que chamam
 * `client.raw(...)` e os helpers de paginação daqui.
 */
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { adfToText, textToAdf, toAdf } from "./adf.js";
import type {
  JiraConfig,
  JiraField,
  JiraTransition,
  JiraUser,
  JqlSearchPage,
  RawField,
  RawIssue,
  RawTransition,
  RawUser,
} from "./types.js";

export { adfToText, textToAdf, toAdf };
export type {
  JiraConfig,
  IssueSummary,
  IssueDetail,
  JiraTransition,
  JiraUser,
  JiraField,
} from "./types.js";

/** Erro normalizado de uma chamada à API do Jira. */
export class JiraError extends Error {
  constructor(
    readonly status: number,
    readonly method: string,
    readonly path: string,
    message: string,
    readonly jiraMessages: string[] = [],
  ) {
    super(message);
    this.name = "JiraError";
  }
}

/** Lê e valida a config a partir do ambiente. `JIRA_PROJECT_KEY` é OPCIONAL. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): JiraConfig {
  const missing: string[] = [];
  const req = (name: string): string => {
    const v = (env[name] ?? "").trim();
    if (!v) missing.push(name);
    return v;
  };
  const baseUrlRaw = req("JIRA_BASE_URL");
  const email = req("JIRA_EMAIL");
  const apiToken = req("JIRA_API_TOKEN");

  if (missing.length) {
    throw new Error(
      `Config do Jira incompleta — faltam variáveis de ambiente: ${missing.join(", ")}. ` +
        `Veja .env.example.`,
    );
  }

  const projectKey = (env.JIRA_PROJECT_KEY ?? "").trim();
  const defaultAssignees = (env.JIRA_DEFAULT_ASSIGNEES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    baseUrl: baseUrlRaw.replace(/\/+$/, ""),
    email,
    apiToken,
    projectKey,
    defaultAssignees,
  };
}

const RETRYABLE = new Set([429, 502, 503, 504]);
const MAX_RETRIES = 3;
const MAX_PAGES = 100; // guarda contra loops de paginação

export class JiraClient {
  private fieldCache: JiraField[] | null = null;

  constructor(private readonly cfg: JiraConfig) {}

  get projectKey(): string {
    return this.cfg.projectKey;
  }

  get defaultAssignees(): string[] {
    return this.cfg.defaultAssignees;
  }

  /** Retorna o projeto explícito ou o default; erro amigável se ambos vazios. */
  resolveProjectKey(param?: string): string {
    const p = (param ?? "").trim() || this.cfg.projectKey;
    if (!p) {
      throw new Error(
        "Projeto não informado: passe `projectKey` ou configure JIRA_PROJECT_KEY no ambiente.",
      );
    }
    return p;
  }

  private authHeader(): string {
    const token = Buffer.from(`${this.cfg.email}:${this.cfg.apiToken}`).toString(
      "base64",
    );
    return `Basic ${token}`;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  private retryDelayMs(res: Response, attempt: number): number {
    const ra = res.headers.get("retry-after");
    if (ra) {
      const secs = Number(ra);
      if (Number.isFinite(secs)) return secs * 1000;
      const when = Date.parse(ra);
      if (!Number.isNaN(when)) return Math.max(0, when - Date.now());
    }
    // backoff exponencial com jitter: ~1s, 2s, 4s
    return 1000 * 2 ** attempt + Math.floor(Math.random() * 250);
  }

  /** Chamada JSON genérica com retry de 429/5xx e erro normalizado. */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.cfg.baseUrl}${path}`;
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, {
        method,
        headers: {
          Authorization: this.authHeader(),
          Accept: "application/json",
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });

      if (res.ok) {
        if (res.status === 204) return undefined as T;
        const raw = await res.text();
        return (raw ? JSON.parse(raw) : undefined) as T;
      }

      if (RETRYABLE.has(res.status) && attempt < MAX_RETRIES) {
        await this.sleep(this.retryDelayMs(res, attempt));
        continue;
      }

      throw await this.buildError(res, method, path);
    }
  }

  private async buildError(
    res: Response,
    method: string,
    path: string,
  ): Promise<JiraError> {
    const text = await res.text().catch(() => "");
    let jiraMessages: string[] = [];
    try {
      const parsed = JSON.parse(text) as {
        errorMessages?: string[];
        errors?: Record<string, string>;
      };
      jiraMessages = [
        ...(parsed.errorMessages ?? []),
        ...Object.entries(parsed.errors ?? {}).map(([k, v]) => `${k}: ${v}`),
      ];
    } catch {
      /* corpo não-JSON */
    }
    const detail = jiraMessages.length
      ? jiraMessages.join("; ")
      : text.slice(0, 500);
    return new JiraError(
      res.status,
      method,
      path,
      `Jira ${method} ${path} falhou: ${res.status} ${res.statusText}${
        detail ? ` — ${detail}` : ""
      }`,
      jiraMessages,
    );
  }

  /** Escape hatch público: qualquer chamada REST à API do Jira. */
  raw<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    return this.request<T>(method, path, body);
  }

  // --- Paginação -----------------------------------------------------------

  /**
   * Paginação clássica (startAt/maxResults/total ou isLast). `buildPath` recebe
   * (startAt, maxResults) e `extract` puxa a lista de itens da página.
   */
  async paginateClassic<T>(
    buildPath: (startAt: number, maxResults: number) => string,
    extract: (page: Record<string, unknown>) => T[],
    opts: { pageSize?: number; maxItems?: number } = {},
  ): Promise<T[]> {
    const pageSize = opts.pageSize ?? 50;
    const maxItems = opts.maxItems ?? Infinity;
    const out: T[] = [];
    let startAt = 0;
    for (let page = 0; page < MAX_PAGES; page++) {
      const data = await this.request<Record<string, unknown>>(
        "GET",
        buildPath(startAt, pageSize),
      );
      const items = extract(data);
      out.push(...items);
      const total = data.total as number | undefined;
      const isLast = data.isLast as boolean | undefined;
      const done =
        out.length >= maxItems ||
        items.length < pageSize ||
        isLast === true ||
        (typeof total === "number" && startAt + items.length >= total);
      if (done) break;
      startAt += items.length || pageSize;
    }
    return maxItems === Infinity ? out : out.slice(0, maxItems);
  }

  /** Uma página da busca JQL nova (`POST /rest/api/3/search/jql`). */
  searchJqlPage(
    jql: string,
    fields: string[],
    maxResults: number,
    nextPageToken?: string,
    expand?: string[],
  ): Promise<JqlSearchPage> {
    const body: Record<string, unknown> = { jql, fields, maxResults };
    if (nextPageToken) body.nextPageToken = nextPageToken;
    if (expand?.length) body.expand = expand;
    return this.request<JqlSearchPage>("POST", "/rest/api/3/search/jql", body);
  }

  /** Varre TODAS as páginas da busca JQL (até maxItems). Usado por relatórios. */
  async paginateJqlSearch(
    jql: string,
    fields: string[],
    opts: { pageSize?: number; maxItems?: number } = {},
  ): Promise<RawIssue[]> {
    const pageSize = opts.pageSize ?? 100;
    const maxItems = opts.maxItems ?? 5000;
    const out: RawIssue[] = [];
    let token: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const data = await this.searchJqlPage(jql, fields, pageSize, token);
      out.push(...(data.issues ?? []));
      token = data.nextPageToken;
      if (data.isLast === true || !token || out.length >= maxItems) break;
    }
    return out.slice(0, maxItems);
  }

  // --- Campos (resolução nome→id p/ custom fields) -------------------------

  async listFields(refresh = false): Promise<JiraField[]> {
    if (this.fieldCache && !refresh) return this.fieldCache;
    const data = await this.request<RawField[]>("GET", "/rest/api/3/field");
    this.fieldCache = (data ?? []).map((f) => ({
      id: f.id,
      name: f.name ?? f.id,
      custom: f.custom ?? false,
      schemaType: f.schema?.type ?? null,
    }));
    return this.fieldCache;
  }

  /**
   * Traduz um objeto de campos cujas chaves podem ser nomes OU ids para o
   * formato `fields` da API (chaveado por id). Colisão de nome → erro.
   */
  async resolveFields(
    input: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (!input || !Object.keys(input).length) return {};
    const fields = await this.listFields();
    const byId = new Map(fields.map((f) => [f.id, f]));
    const byName = new Map<string, JiraField[]>();
    for (const f of fields) {
      const k = f.name.toLowerCase();
      byName.set(k, [...(byName.get(k) ?? []), f]);
    }
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      if (byId.has(key)) {
        out[key] = value;
        continue;
      }
      const matches = byName.get(key.toLowerCase()) ?? [];
      if (matches.length === 1) {
        out[matches[0].id] = value;
      } else if (matches.length > 1) {
        throw new Error(
          `O nome de campo "${key}" é ambíguo (ids: ${matches
            .map((m) => m.id)
            .join(", ")}). Passe o id do campo.`,
        );
      } else {
        throw new Error(
          `Campo "${key}" não encontrado. Use list_fields para descobrir nome/id.`,
        );
      }
    }
    return out;
  }

  // --- Usuários ------------------------------------------------------------

  async searchUsers(query: string, maxResults = 20): Promise<JiraUser[]> {
    const data = await this.request<RawUser[]>(
      "GET",
      `/rest/api/3/user/search?query=${encodeURIComponent(query)}&maxResults=${maxResults}`,
    );
    return (data ?? []).map((u) => ({
      displayName: u.displayName ?? "",
      accountId: u.accountId,
      email: u.emailAddress ?? null,
      active: u.active ?? false,
    }));
  }

  /** Resolve um identificador (accountId ou e-mail) para accountId. */
  async resolveAccountId(identifier: string): Promise<string> {
    const id = identifier.trim();
    if (!id.includes("@")) return id; // já é accountId
    const users = await this.searchUsers(id);
    const match =
      users.find((u) => (u.email ?? "").toLowerCase() === id.toLowerCase()) ??
      users[0];
    if (!match) {
      throw new Error(`Nenhum usuário do Jira encontrado para "${identifier}".`);
    }
    return match.accountId;
  }

  // --- Transições (usadas por múltiplas tools) -----------------------------

  async getTransitions(key: string): Promise<JiraTransition[]> {
    const data = await this.request<{ transitions: RawTransition[] }>(
      "GET",
      `/rest/api/3/issue/${encodeURIComponent(key)}/transitions`,
    );
    return (data.transitions ?? []).map((t) => ({
      id: t.id,
      name: t.name,
      to: t.to?.name ?? "",
    }));
  }

  // --- Anexos (multipart, fora do request<T> JSON) -------------------------

  async uploadAttachment(
    key: string,
    filePath: string,
  ): Promise<{ id: string; filename: string }[]> {
    const buf = await readFile(filePath);
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(buf)]), basename(filePath));
    const url = `${this.cfg.baseUrl}/rest/api/3/issue/${encodeURIComponent(
      key,
    )}/attachments`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: this.authHeader(),
        Accept: "application/json",
        "X-Atlassian-Token": "no-check",
      },
      body: form,
    });
    if (!res.ok) throw await this.buildError(res, "POST", `${key}/attachments`);
    const data = (await res.json()) as { id: string; filename: string }[];
    return data ?? [];
  }
}
