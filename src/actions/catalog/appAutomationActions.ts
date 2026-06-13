import { z, type ZodType } from "zod";
import type { CanonicalAction, RiskLevel } from "./canonicalActions.js";

function appAction(
  name: string,
  description: string,
  zodSchema: ZodType,
  opts: {
    risk?: RiskLevel;
    side_effects?: string[];
    requires_approval?: boolean;
    planner_guidance?: string;
    output_json_schema?: Record<string, unknown>;
  } = {},
): CanonicalAction {
  return {
    name,
    category: "services",
    description,
    zodSchema,
    params_json_schema: {},
    output_json_schema: opts.output_json_schema ?? {},
    risk: opts.risk ?? "medium",
    side_effects: opts.side_effects ?? [],
    requires_platform_validation: true,
    requires_approval: opts.requires_approval ?? false,
    planner_guidance: opts.planner_guidance ?? "",
  };
}

const ProviderRouteMetadataSchema = z.object({
  automation_vendor: z.string().min(1).optional(),
  catalog_action_id: z.string().min(1).optional(),
});

const email_create = appAction(
  "email.create",
  "Create or draft an email through a provider selected by params.email_provider.",
  ProviderRouteMetadataSchema.extend({
    to: z.string().min(1),
    subject: z.string().optional(),
    body: z.string().optional(),
    cc: z.array(z.string()).optional(),
    bcc: z.array(z.string()).optional(),
    email_provider: z.string().min(1).optional(),
  }),
  {
    risk: "medium",
    side_effects: ["external_app", "email:draft"],
    planner_guidance: "Use provider-neutral email.create. Put gmail, outlook, or another provider in params.email_provider; do not use provider-specific task names.",
  },
);

const email_search = appAction(
  "email.search",
  "Search email messages through a provider selected by params.email_provider.",
  ProviderRouteMetadataSchema.extend({
    query: z.string().min(1),
    limit: z.number().int().positive().optional(),
    email_provider: z.string().min(1).optional(),
  }),
  {
    risk: "low",
    side_effects: [],
    planner_guidance: "Use as a find_out_more task. Put gmail, outlook, or another provider in params.email_provider; do not use provider-specific task names.",
  },
);

const email_send = appAction(
  "email.send",
  "Send an email through a provider selected by params.email_provider.",
  ProviderRouteMetadataSchema.extend({
    to: z.string().min(1),
    subject: z.string().optional(),
    body: z.string().min(1),
    cc: z.array(z.string()).optional(),
    bcc: z.array(z.string()).optional(),
    email_provider: z.string().min(1).optional(),
  }),
  {
    risk: "critical",
    side_effects: ["external_app", "email:send"],
    requires_approval: true,
    planner_guidance: "Use provider-neutral email.send only with explicit user intent and platform approval. Put provider choice in params.email_provider.",
  },
);

const message_send = appAction(
  "message.send",
  "Send a chat/message through a provider selected by params.message_provider.",
  ProviderRouteMetadataSchema.extend({
    text: z.string().min(1),
    channel: z.string().optional(),
    recipient: z.string().optional(),
    message_provider: z.string().min(1).optional(),
  }),
  {
    risk: "critical",
    side_effects: ["external_app", "message:send"],
    requires_approval: true,
    planner_guidance: "Use message.send for Slack, Discord, Teams, or similar providers. Put the concrete provider in params.message_provider.",
  },
);

const issue_create = appAction(
  "issue.create",
  "Create an issue or ticket through a provider selected by params.issue_provider.",
  ProviderRouteMetadataSchema.extend({
    title: z.string().min(1),
    body: z.string().optional(),
    description: z.string().optional(),
    repo: z.string().optional(),
    team: z.string().optional(),
    project: z.string().optional(),
    issue_provider: z.string().min(1).optional(),
  }),
  {
    risk: "high",
    side_effects: ["external_app", "issue:create"],
    requires_approval: true,
    planner_guidance: "Use issue.create for GitHub, Linear, Jira, or similar systems. Put the concrete provider in params.issue_provider.",
  },
);

const calendar_event_create = appAction(
  "calendar_event.create",
  "Create a calendar event through a provider selected by params.calendar_provider.",
  ProviderRouteMetadataSchema.extend({
    title: z.string().min(1),
    start: z.string().min(1),
    end: z.string().min(1),
    attendees: z.array(z.string()).optional(),
    calendar_provider: z.string().min(1).optional(),
  }),
  {
    risk: "high",
    side_effects: ["external_app", "calendar_event:create"],
    requires_approval: true,
    planner_guidance: "Use calendar_event.create for Google Calendar, Outlook Calendar, or similar systems. Put the concrete provider in params.calendar_provider.",
  },
);

const repository_search = appAction(
  "repository.search",
  "Search repository content, issues, or pull requests through a provider selected by params.repository_provider.",
  ProviderRouteMetadataSchema.extend({
    repo: z.string().min(1),
    query: z.string().min(1),
    kind: z.string().optional(),
    repository_provider: z.string().min(1).optional(),
  }),
  {
    risk: "low",
    side_effects: [],
    planner_guidance: "Use as a find_out_more task. Put github, gitlab, or another provider in params.repository_provider.",
  },
);

const spreadsheet_row_append = appAction(
  "spreadsheet_row.append",
  "Append a row to a spreadsheet through a provider selected by params.spreadsheet_provider.",
  ProviderRouteMetadataSchema.extend({
    spreadsheet_id: z.string().min(1),
    row: z.record(z.unknown()).or(z.array(z.unknown())),
    sheet: z.string().optional(),
    spreadsheet_provider: z.string().min(1).optional(),
  }),
  {
    risk: "high",
    side_effects: ["external_app", "spreadsheet:append_row"],
    requires_approval: true,
    planner_guidance: "Use spreadsheet_row.append for Google Sheets, Excel, or similar systems. Put provider choice in params.spreadsheet_provider.",
  },
);

const page_create = appAction(
  "page.create",
  "Create a page or document through a provider selected by params.page_provider.",
  ProviderRouteMetadataSchema.extend({
    title: z.string().min(1),
    parent: z.string().optional(),
    content: z.string().optional(),
    page_provider: z.string().min(1).optional(),
  }),
  {
    risk: "high",
    side_effects: ["external_app", "page:create"],
    requires_approval: true,
    planner_guidance: "Use page.create for Notion, Confluence, or similar systems. Put provider choice in params.page_provider.",
  },
);

const contact_create = appAction(
  "contact.create",
  "Create a contact through a provider selected by params.contact_provider.",
  ProviderRouteMetadataSchema.extend({
    email: z.string().min(1),
    firstname: z.string().optional(),
    lastname: z.string().optional(),
    contact_provider: z.string().min(1).optional(),
  }),
  {
    risk: "high",
    side_effects: ["external_app", "contact:create"],
    requires_approval: true,
    planner_guidance: "Use contact.create for HubSpot, Salesforce, or similar systems. Put provider choice in params.contact_provider.",
  },
);

const browser_task_perform = appAction(
  "browser_task.perform",
  "Perform a browser automation task through a provider selected by params.browser_provider.",
  ProviderRouteMetadataSchema.extend({
    instruction: z.string().min(1),
    url: z.string().optional(),
    browser_provider: z.string().min(1).optional(),
  }),
  {
    risk: "high",
    side_effects: ["browser", "external_app"],
    requires_approval: true,
    planner_guidance: "Use browser_task.perform for web automation. Put stagehand, browser_use, skyvern, or another provider in params.browser_provider or automation_vendor.",
  },
);

const visual_browser_task_perform = appAction(
  "visual_browser_task.perform",
  "Perform a visual browser automation task through a provider selected by params.browser_provider.",
  ProviderRouteMetadataSchema.extend({
    instruction: z.string().min(1),
    url: z.string().optional(),
    browser_provider: z.string().min(1).optional(),
  }),
  {
    risk: "high",
    side_effects: ["browser", "external_app"],
    requires_approval: true,
    planner_guidance: "Use visual_browser_task.perform when visual browser reasoning is required. Put provider choice in params.browser_provider or automation_vendor.",
  },
);

export const APP_AUTOMATION_ACTIONS: CanonicalAction[] = [
  browser_task_perform,
  calendar_event_create,
  contact_create,
  email_create,
  email_search,
  email_send,
  issue_create,
  message_send,
  page_create,
  repository_search,
  spreadsheet_row_append,
  visual_browser_task_perform,
];
