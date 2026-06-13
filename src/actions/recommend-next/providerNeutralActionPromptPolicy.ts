export const PROVIDER_NEUTRAL_APP_ACTION_NAMES = [
  "browser_task.perform",
  "calendar_event.create",
  "contact.create",
  "email.create",
  "email.search",
  "email.send",
  "issue.create",
  "message.send",
  "page.create",
  "repository.search",
  "spreadsheet_row.append",
  "visual_browser_task.perform",
] as const;

export const PROVIDER_SPECIFIC_ACTION_ALIASES: Record<string, string> = {
  "discord.send_message": "message.send",
  "github.create_issue": "issue.create",
  "github.search_repo": "repository.search",
  "gmail.create_email": "email.create",
  "gmail.search_email": "email.search",
  "gmail.send_email": "email.send",
  "google_calendar.create_event": "calendar_event.create",
  "google_sheets.append_row": "spreadsheet_row.append",
  "hubspot.create_contact": "contact.create",
  "jira.create_issue": "issue.create",
  "linear.create_issue": "issue.create",
  "notion.create_page": "page.create",
  "outlook.create_email": "email.create",
  "outlook.send_email": "email.send",
  "outlook_calendar.create_event": "calendar_event.create",
  "slack.send_message": "message.send",
  "web.perform_task": "browser_task.perform",
  "web.visual_task": "visual_browser_task.perform",
};

export const PROVIDER_PARAMETER_BY_ACTION: Record<string, string> = {
  "browser_task.perform": "browser_provider",
  "calendar_event.create": "calendar_provider",
  "contact.create": "contact_provider",
  "email.create": "email_provider",
  "email.search": "email_provider",
  "email.send": "email_provider",
  "issue.create": "issue_provider",
  "message.send": "message_provider",
  "page.create": "page_provider",
  "repository.search": "repository_provider",
  "spreadsheet_row.append": "spreadsheet_provider",
  "visual_browser_task.perform": "browser_provider",
};

export function providerNeutralActionPromptPolicy(): Record<string, unknown> {
  return {
    purpose: "Provider-neutral app automation action naming policy.",
    allowed_root_action_names: PROVIDER_NEUTRAL_APP_ACTION_NAMES,
    provider_parameter_by_action: PROVIDER_PARAMETER_BY_ACTION,
    provider_specific_aliases: PROVIDER_SPECIFIC_ACTION_ALIASES,
    rules: [
      "When selecting app automation, output only a provider-neutral root action as task_name.",
      "Put app/provider specificity in params using the provider parameter for that action.",
      "Do not output provider-specific aliases such as gmail.create_email, outlook.create_email, slack.send_message, or github.create_issue as task_name.",
      "If a legacy catalog action is needed for downstream routing, put it in params.catalog_action_id, not task_name.",
      "If an execution vendor route is preferred, put it in params.automation_vendor, not task_name.",
    ],
    examples: [
      {
        task_name: "email.create",
        params: { email_provider: "gmail", catalog_action_id: "gmail.create_email" },
      },
      {
        task_name: "email.create",
        params: { email_provider: "outlook", catalog_action_id: "outlook.create_email" },
      },
      {
        task_name: "message.send",
        params: { message_provider: "slack", catalog_action_id: "slack.send_message" },
      },
      {
        task_name: "issue.create",
        params: { issue_provider: "github", catalog_action_id: "github.create_issue" },
      },
    ],
  };
}
