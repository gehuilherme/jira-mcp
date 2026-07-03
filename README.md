# jira-mcp

Generic MCP server (stdio) **for Jira Cloud** (REST API v3 + Agile 1.0), for use in any project within Claude Code. Covers the issue lifecycle, search/reporting, sprints, custom fields, attachments, worklogs, links, and an *escape hatch* for any API endpoint.

Project-agnostic: `JIRA_PROJECT_KEY` is an **optional default**. The tools that operate on a project accept an explicit `projectKey` and only fall back to the default when it is configured.

## Tools (45)

**Issues** — `get_issue`, `create_issue`✍, `edit_issue`✍, `delete_issue`⚠, `create_subtask`✍
**Search/reporting** — `search_issues` (free-form JQL + pagination), `count_issues`, `group_issues`, `stale_issues`
**Workflow** — `list_transitions`, `transition_issue`✍
**People** — `assign_issue`✍, `search_users`, `get_current_user`, `list_watchers`, `add_watcher`✍, `remove_watcher`✍
**Comments** — `list_comments`, `add_comment`✍, `edit_comment`✍, `delete_comment`⚠
**Metadata** — `list_fields`, `get_create_meta`, `get_edit_meta`, `list_projects`, `get_project`
**Organization** — `edit_labels`✍, `list_components`, `set_components`✍, `list_link_types`, `link_issues`✍, `delete_link`⚠
**Attachments/time** — `list_attachments`, `add_attachment`✍, `delete_attachment`⚠, `list_worklogs`, `add_worklog`✍, `delete_worklog`⚠
**Agile** — `list_boards`, `list_sprints`, `sprint_issues`, `move_issues_to_sprint`✍, `move_issues_to_backlog`✍, `create_sprint`✍
**Generic** — `jira_request` (any REST method/path)

✍ = write · ⚠ = destructive (requires `confirm: true`; without it returns a *dry-run*)

## Highlights

- **Custom fields without hardcoding:** `list_fields`/`get_create_meta` discover the fields; `create_issue`/`edit_issue` accept `customFields` by **name or id** (name collision → error asking for the id).
- **Truly paginated search:** `search_issues` uses the new endpoint (`nextPageToken`/`isLast`); reports scan every page.
- **Robustness:** automatic retry on `429`/`5xx` (respects `Retry-After`), normalized Jira errors, built-in pagination.
- **Guard-rails:** every destructive operation requires `confirm: true`.

## Setup

1. **API token:** https://id.atlassian.com/manage-profile/security/api-tokens
2. **Build:**
   ```bash
   cd "jira-mcp"
   npm install
   npm run build
   ```
3. **Credentials:** `cp .env.example .env` and fill in `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN` (and, optionally, `JIRA_PROJECT_KEY` / `JIRA_DEFAULT_ASSIGNEES`).
4. **Smoke test:**
   ```bash
   npm run smoke
   ```
   Confirms authentication (`/myself`) and, if a default project is set, lists up to 5 issues.

## Registering in Claude Code

In the root `.mcp.json` (key `jira` → tools appear as `mcp__jira__*`):

```jsonc
{
  "mcpServers": {
    "jira": {
      "command": "node",
      "args": ["/path/to/jira-mcp/dist/index.js"],
      "env": {
        "JIRA_BASE_URL": "https://yourcompany.atlassian.net",
        "JIRA_EMAIL": "you@company.com",
        "JIRA_API_TOKEN": "your-token",
        "JIRA_PROJECT_KEY": "PROJ",
        "JIRA_DEFAULT_ASSIGNEES": ""
      }
    }
  }
}
```

Restart Claude Code and run `/mcp` to confirm that `jira` connected.

## Transports

The server supports two transports, selected by `MCP_TRANSPORT` (or `--http`):

- **`stdio`** (default) — local, single user. One process reads one set of
  credentials from the environment. This is everything described above.
- **`http`** — multi-user server. Exposes MCP at `POST /mcp` and is **stateless**:
  each request carries the *caller's own* Jira credentials in headers, so every
  user acts as themselves. The `JIRA_*` env vars are ignored in this mode.

Header names (per request): `X-Jira-Base-Url`, `X-Jira-Email`, `X-Jira-Token`
(required) plus optional `X-Jira-Project-Key`, `X-Jira-Default-Assignees`.

## Deploying on Debian (multi-user, HTTP)

Each user connects with their own Jira token; the server stores no secrets.

1. **Host the code** at `/opt/jira-mcp`, then build:
   ```bash
   cd /opt/jira-mcp && npm ci && npm run build
   ```
2. **Run as a service** — copy [`deploy/jira-mcp.service`](deploy/jira-mcp.service)
   to `/etc/systemd/system/`, create the user, enable it:
   ```bash
   adduser --system --group jira-mcp
   systemctl daemon-reload && systemctl enable --now jira-mcp
   curl -s http://127.0.0.1:3000/healthz   # -> ok
   ```
   Config lives in the unit's `Environment=` lines (`HTTP_HOST`, `HTTP_PORT`).
3. **Front it with the company proxy** — the proxy terminates TLS and provides
   external access; the Debian box speaks **plain HTTP**. Point the proxy at
   `http://<debian>:3000` and route e.g. `https://jira-mcp.company.com/mcp`.

### Security assumptions (important)

This runs HTTP without local TLS **on purpose** — TLS is the proxy's job. That
is only safe under these conditions:

- **The proxy → Debian hop is plaintext.** The Jira token travels unciphered on
  that segment, so it must be a *trusted internal network*.
- **Firewall the port to the proxy only** (`ufw allow from <proxy-ip> to any port 3000`),
  or bind `HTTP_HOST=127.0.0.1` if the proxy runs on the same host. Do **not**
  leave the port open to the rest of the LAN.
- **Credentials are never logged** — the server logs only method/path/status.
- If the internal network ever stops being trustworthy, add TLS/mTLS on this hop.

### User configuration (remote)

Each user points Claude Code at the proxy URL with **their own** token:

```jsonc
{
  "mcpServers": {
    "jira": {
      "type": "http",
      "url": "https://jira-mcp.company.com/mcp",
      "headers": {
        "X-Jira-Base-Url": "https://yourcompany.atlassian.net",
        "X-Jira-Email": "you@company.com",
        "X-Jira-Token": "your-personal-token"
      }
    }
  }
}
```

## Notes

- **Security:** `.env` and `.mcp.json` containing secrets must NOT be committed. If a token leaks, **rotate it** in the Atlassian panel.
- **Emails:** Jira Cloud does not accept a direct email in JQL/assignment (GDPR); the server resolves email → `accountId` automatically.
- **Writes** only happen when explicitly called — and destructive ones require `confirm: true`.
- **Migrating from v1:** the deprecated aliases (`assign_card`, `get_card`, `comment_card`, `transition_card`, `list_homologacao_cards`) have been **removed** — use the generic equivalents (`assign_issue`, `get_issue`, `add_comment`, `transition_issue`, `search_issues`). When renaming the server key from `jira-homolog` to `jira`, update permissions in `.claude/settings*.json` that reference `mcp__jira-homolog__*`.
