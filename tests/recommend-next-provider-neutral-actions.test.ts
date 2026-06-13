import { describe, expect, it, beforeAll } from "vitest";
import { CANONICAL_ACTION_MAP, CANONICAL_ACTIONS } from "../src/actions/catalog/canonicalActions.js";
import { hydrateCanonicalSchemas } from "../src/actions/catalog/seedCanonicalActions.js";
import { buildRecommendNextPrompt } from "../src/actions/recommend-next/promptBuilder.js";

beforeAll(() => {
  hydrateCanonicalSchemas();
});

describe("provider-neutral app automation actions", () => {
  it("registers top-level app actions in the canonical catalog", () => {
    for (const name of [
      "email.create",
      "email.search",
      "email.send",
      "message.send",
      "issue.create",
      "calendar_event.create",
      "repository.search",
      "spreadsheet_row.append",
      "page.create",
      "contact.create",
      "browser_task.perform",
      "visual_browser_task.perform",
    ]) {
      expect(CANONICAL_ACTION_MAP.has(name)).toBe(true);
    }
  });

  it("does not register provider-specific app aliases as root task names", () => {
    for (const alias of [
      "gmail.create_email",
      "outlook.create_email",
      "slack.send_message",
      "discord.send_message",
      "github.create_issue",
      "jira.create_issue",
      "google_calendar.create_event",
    ]) {
      expect(CANONICAL_ACTION_MAP.has(alias)).toBe(false);
    }
  });

  it("adds provider-neutral app action guidance to the recommend-next prompt", () => {
    const prompt = buildRecommendNextPrompt({
      context: {
        task_type: "app_automation",
        completed_actions: [],
        context: { prompt: "Create an email draft in Outlook" },
      },
      action_catalog: CANONICAL_ACTIONS.map((action) => ({
        name: action.name,
        description: action.description,
        params_json_schema: action.params_json_schema,
        output_json_schema: action.output_json_schema,
        risk: action.risk,
        side_effects: action.side_effects,
        requires_platform_validation: true,
      })),
    });

    const policySource = prompt.sources.find((source) => source.name === "provider_neutral_app_action_policy");
    expect(policySource).toBeDefined();
    expect(JSON.stringify(policySource!.content)).toContain("email.create");
    expect(JSON.stringify(policySource!.content)).toContain("outlook.create_email");

    const system = prompt.messages.find((message) => message.role === "system")!.content;
    expect(system).toContain("use only provider-neutral root task names");
    expect(system).toContain("Do not use provider-specific or app-specific names");
    expect(system).toContain("params.catalog_action_id");
  });
});
