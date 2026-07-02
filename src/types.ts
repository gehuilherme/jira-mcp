/**
 * Domain types (normalized) and "raw" (partial) types from the Jira Cloud
 * REST API v3 / Agile 1.0. Kept outside the client so that the tool modules
 * can import shapes without depending on the client implementation.
 */

export interface JiraConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
  /** Default project (optional). "" = not configured. */
  projectKey: string;
  /** Default assignees for convenience filters. */
  defaultAssignees: string[];
}

export interface IssueSummary {
  key: string;
  summary: string;
  status: string | null;
  assignee: { displayName: string; accountId: string } | null;
  priority: string | null;
  updated: string | null;
}

export interface IssueDetail extends IssueSummary {
  description: string;
  comments: { id: string; author: string; created: string; body: string }[];
  labels: string[];
  issueType: string | null;
  reporter: { displayName: string; accountId: string } | null;
  created: string | null;
}

export interface JiraTransition {
  id: string;
  name: string;
  to: string;
}

export interface JiraUser {
  displayName: string;
  accountId: string;
  email: string | null;
  active: boolean;
}

export interface JiraField {
  id: string;
  name: string;
  custom: boolean;
  schemaType: string | null;
}

// --- Raw API types (partial) ---

export interface RawIssue {
  id?: string;
  key: string;
  fields?: {
    summary?: string;
    status?: { name?: string };
    assignee?: { displayName?: string; accountId?: string } | null;
    reporter?: { displayName?: string; accountId?: string } | null;
    priority?: { name?: string } | null;
    issuetype?: { name?: string } | null;
    labels?: string[];
    updated?: string;
    created?: string;
    description?: unknown;
    comment?: {
      comments?: RawComment[];
    };
    [key: string]: unknown;
  };
}

export interface RawComment {
  id?: string;
  author?: { displayName?: string };
  created?: string;
  body?: unknown;
}

export interface RawTransition {
  id: string;
  name: string;
  to?: { name?: string };
}

export interface RawUser {
  displayName?: string;
  accountId: string;
  emailAddress?: string;
  active?: boolean;
}

export interface RawField {
  id: string;
  name?: string;
  custom?: boolean;
  schema?: { type?: string };
}

/** Page from the new JQL search endpoint (nextPageToken / isLast). */
export interface JqlSearchPage {
  issues?: RawIssue[];
  nextPageToken?: string;
  isLast?: boolean;
}

/** Classic page (startAt / maxResults / total). */
export interface ClassicPage<T> {
  startAt?: number;
  maxResults?: number;
  total?: number;
  isLast?: boolean;
  values?: T[];
}

export function toIssueSummary(issue: RawIssue): IssueSummary {
  const f = issue.fields ?? {};
  return {
    key: issue.key,
    summary: (f.summary as string) ?? "",
    status: f.status?.name ?? null,
    assignee: f.assignee
      ? {
          displayName: f.assignee.displayName ?? "",
          accountId: f.assignee.accountId ?? "",
        }
      : null,
    priority: f.priority?.name ?? null,
    updated: (f.updated as string) ?? null,
  };
}
