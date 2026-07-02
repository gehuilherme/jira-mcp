# jira-mcp

Servidor MCP (stdio) **genérico para o Jira Cloud** (REST API v3 + Agile 1.0), para uso em qualquer projeto dentro do Claude Code. Cobre o ciclo de vida de issues, busca/relatórios, sprints, campos customizados, anexos, worklogs, links e um *escape hatch* para qualquer endpoint da API.

Project-agnostic: `JIRA_PROJECT_KEY` é um **default opcional**. As tools que mexem em um projeto aceitam `projectKey` explícito e só caem no default quando ele está configurado.

## Tools (45)

**Issues** — `get_issue`, `create_issue`✍, `edit_issue`✍, `delete_issue`⚠, `create_subtask`✍
**Busca/relatórios** — `search_issues` (JQL livre + paginação), `count_issues`, `group_issues`, `stale_issues`
**Workflow** — `list_transitions`, `transition_issue`✍
**Pessoas** — `assign_issue`✍, `search_users`, `get_current_user`, `list_watchers`, `add_watcher`✍, `remove_watcher`✍
**Comentários** — `list_comments`, `add_comment`✍, `edit_comment`✍, `delete_comment`⚠
**Metadados** — `list_fields`, `get_create_meta`, `get_edit_meta`, `list_projects`, `get_project`
**Organização** — `edit_labels`✍, `list_components`, `set_components`✍, `list_link_types`, `link_issues`✍, `delete_link`⚠
**Anexos/tempo** — `list_attachments`, `add_attachment`✍, `delete_attachment`⚠, `list_worklogs`, `add_worklog`✍, `delete_worklog`⚠
**Agile** — `list_boards`, `list_sprints`, `sprint_issues`, `move_issues_to_sprint`✍, `move_issues_to_backlog`✍, `create_sprint`✍
**Genérico** — `jira_request` (qualquer método/path REST)

✍ = escrita · ⚠ = destrutiva (exige `confirm: true`; sem isso retorna *dry-run*)

## Destaques

- **Campos customizados sem hardcode:** `list_fields`/`get_create_meta` descobrem os campos; `create_issue`/`edit_issue` aceitam `customFields` por **nome ou id** (colisão de nome → erro pedindo o id).
- **Busca paginada de verdade:** `search_issues` usa o endpoint novo (`nextPageToken`/`isLast`); relatórios varrem todas as páginas.
- **Robustez:** retry automático em `429`/`5xx` (respeita `Retry-After`), erros do Jira normalizados, paginação embutida.
- **Guard-rails:** toda operação destrutiva exige `confirm: true`.

## Setup

1. **API token:** https://id.atlassian.com/manage-profile/security/api-tokens
2. **Compilar:**
   ```bash
   cd "jira-mcp"
   npm install
   npm run build
   ```
3. **Credenciais:** `cp .env.example .env` e preencha `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN` (e, opcionalmente, `JIRA_PROJECT_KEY` / `JIRA_DEFAULT_ASSIGNEES`).
4. **Smoke test:**
   ```bash
   npm run smoke
   ```
   Confirma a autenticação (`/myself`) e, se houver projeto default, lista até 5 issues.

## Registrar no Claude Code

No `.mcp.json` da raiz (chave `jira` → tools aparecem como `mcp__jira__*`):

```jsonc
{
  "mcpServers": {
    "jira": {
      "command": "node",
      "args": ["/caminho/para/jira-mcp/dist/index.js"],
      "env": {
        "JIRA_BASE_URL": "https://suaempresa.atlassian.net",
        "JIRA_EMAIL": "voce@empresa.com",
        "JIRA_API_TOKEN": "seu-token",
        "JIRA_PROJECT_KEY": "PROJ",
        "JIRA_DEFAULT_ASSIGNEES": ""
      }
    }
  }
}
```

Reinicie o Claude Code e rode `/mcp` para confirmar que `jira` conectou.

## Notas

- **Segurança:** `.env` e `.mcp.json` com segredos NÃO devem ser comitados. Se um token vazar, **rotacione-o** no painel da Atlassian.
- **E-mails:** o Jira Cloud não aceita e-mail direto em JQL/atribuição (GDPR); o servidor resolve e-mail → `accountId` automaticamente.
- **Escritas** só ocorrem quando explicitamente chamadas — e as destrutivas exigem `confirm: true`.
- **Migração da v1:** os aliases deprecados (`assign_card`, `get_card`, `comment_card`, `transition_card`, `list_homologacao_cards`) foram **removidos** — use os equivalentes genéricos (`assign_issue`, `get_issue`, `add_comment`, `transition_issue`, `search_issues`). Ao renomear a chave do servidor de `jira-homolog` para `jira`, atualize permissões em `.claude/settings*.json` que referenciem `mcp__jira-homolog__*`.
