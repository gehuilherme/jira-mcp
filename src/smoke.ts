/**
 * Smoke test isolado (fora do MCP): confirma auth e conectividade com o Jira.
 * Valida credenciais via /myself e, se houver projeto default configurado,
 * faz uma busca JQL de amostra. Rode: `npm run smoke`. Lê o .env local.
 */
import { JiraClient, loadConfig } from "./jira-client.js";
import { toIssueSummary } from "./types.js";

try {
  process.loadEnvFile(); // carrega ./.env em process.env (Node >= 20.12)
} catch {
  // .env ausente — segue com o que estiver no ambiente.
}

async function main(): Promise<void> {
  const client = new JiraClient(loadConfig());

  const me = await client.raw<{ displayName?: string; accountId?: string }>(
    "GET",
    "/rest/api/3/myself",
  );
  console.log(
    `OK — autenticado como: ${me.displayName ?? "?"} (accountId ${me.accountId ?? "?"}).`,
  );

  if (!client.projectKey) {
    console.log("Sem JIRA_PROJECT_KEY — pulando a busca de amostra.");
    return;
  }

  const jql = `project = "${client.projectKey}" ORDER BY updated DESC`;
  console.log(`Consultando: ${jql}`);
  const page = await client.searchJqlPage(
    jql,
    ["summary", "status", "assignee", "priority", "updated"],
    5,
  );
  const issues = (page.issues ?? []).map(toIssueSummary);
  console.log(`OK — ${issues.length} issue(s) retornada(s) (mostrando até 5):`);
  for (const i of issues) {
    console.log(
      `  ${i.key} [${i.status}] — ${i.summary} — ${
        i.assignee ? i.assignee.displayName : "SEM RESPONSÁVEL"
      }`,
    );
  }
}

main().catch((err) => {
  console.error("Smoke test FALHOU:", err instanceof Error ? err.message : err);
  process.exit(1);
});
