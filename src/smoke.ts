/**
 * Standalone smoke test (outside the MCP): confirms auth and connectivity with Jira.
 * Validates credentials via /myself and, if a default project is configured,
 * runs a sample JQL search. Run: `npm run smoke`. Reads the local .env.
 */
import { JiraClient, loadConfig } from "./jira-client.js";
import { toIssueSummary } from "./types.js";

try {
  process.loadEnvFile(); // loads ./.env into process.env (Node >= 20.12)
} catch {
  // .env missing — proceed with whatever is in the environment.
}

async function main(): Promise<void> {
  const client = new JiraClient(loadConfig());

  const me = await client.raw<{ displayName?: string; accountId?: string }>(
    "GET",
    "/rest/api/3/myself",
  );
  console.log(
    `OK — authenticated as: ${me.displayName ?? "?"} (accountId ${me.accountId ?? "?"}).`,
  );

  if (!client.projectKey) {
    console.log("No JIRA_PROJECT_KEY — skipping the sample search.");
    return;
  }

  const jql = `project = "${client.projectKey}" ORDER BY updated DESC`;
  console.log(`Querying: ${jql}`);
  const page = await client.searchJqlPage(
    jql,
    ["summary", "status", "assignee", "priority", "updated"],
    5,
  );
  const issues = (page.issues ?? []).map(toIssueSummary);
  console.log(`OK — ${issues.length} issue(s) returned (showing up to 5):`);
  for (const i of issues) {
    console.log(
      `  ${i.key} [${i.status}] — ${i.summary} — ${
        i.assignee ? i.assignee.displayName : "UNASSIGNED"
      }`,
    );
  }
}

main().catch((err) => {
  console.error("Smoke test FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
