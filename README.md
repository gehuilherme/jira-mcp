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

## Notes

- **Security:** `.env` and `.mcp.json` containing secrets must NOT be committed. If a token leaks, **rotate it** in the Atlassian panel.
- **Emails:** Jira Cloud does not accept a direct email in JQL/assignment (GDPR); the server resolves email → `accountId` automatically.
- **Writes** only happen when explicitly called — and destructive ones require `confirm: true`.
- **Migrating from v1:** the deprecated aliases (`assign_card`, `get_card`, `comment_card`, `transition_card`, `list_homologacao_cards`) have been **removed** — use the generic equivalents (`assign_issue`, `get_issue`, `add_comment`, `transition_issue`, `search_issues`). When renaming the server key from `jira-homolog` to `jira`, update permissions in `.claude/settings*.json` that reference `mcp__jira-homolog__*`.
