import { providerNeutralActionPromptPolicy } from "./providerNeutralActionPromptPolicy.js";
import type { RecommendNextPromptInput, RecommendNextPromptMessages, RecommendNextPromptSource } from "./types.js";

function safeJson(value: unknown): string {
  return JSON.stringify(value ?? null, null, 2);
}

function clip(value: string, max = 5000): string {
  return value.length > max ? `${value.slice(0, max)}\n...<truncated>` : value;
}

function graphPromptRoutingGuidance(input: RecommendNextPromptInput): RecommendNextPromptSource | null {
  const record = input.context.context && typeof input.context.context === "object" ? input.context.context as Record<string, unknown> : {};
  const routeOnlyPass = (input.visible_actions ?? []).includes("session.route_prompt");
  if (!routeOnlyPass && record.prompt_kind !== "graph_session_followup") return null;
  return {
    name: "graph_session_prompt_routing_policy",
    priority: 95,
    content: {
      required_task_name: "session.route_prompt",
      required_decision: "execute",
      source_of_truth: "visible_actions/call-site phase, not inferred task_type",
      routes: {
        continue_active: "Use for ordinary follow-up implementation, refinement, validation, or execution under the current session goal.",
        question_only: "Use for explanation, reasoning, status, or clarification prompts where no work item or new goal should be created.",
        create_child_goal: "Use when the user explicitly asks to track a separate subtask under the same repo/context.",
        create_sibling_goal: "Use when the user explicitly asks for a new session, unrelated task, different goal, or separate root objective.",
      },
      invariant: "Initial home prompts create goal sessions in the platform. Follow-up chat is routed through recommend-next before the platform mutates the graph.",
      params_contract: {
        route: "one of continue_active | question_only | create_child_goal | create_sibling_goal",
        target_session_id: "current graph session id",
        prompt: "the user's follow-up prompt",
        reason: "short explanation for the selected route",
      },
    },
  };
}

function visibleActionCatalog(input: RecommendNextPromptInput) {
  const visible = new Set(input.visible_actions ?? []);
  if (visible.size === 0) return input.action_catalog;
  return input.action_catalog.filter((action) => visible.has(action.name));
}

export function buildRecommendNextPrompt(input: RecommendNextPromptInput): RecommendNextPromptMessages {
  const routingGuidance = graphPromptRoutingGuidance(input);
  const actionCatalog = visibleActionCatalog(input);
  const sources: RecommendNextPromptSource[] = [
    { name: "current_state", priority: 100, content: input.context },
    ...(routingGuidance ? [routingGuidance] : []),
    ...(input.visible_actions && input.visible_actions.length > 0 ? [{ name: "visible_tasks", priority: 92, content: input.visible_actions }] : []),
    {
      name: "provider_neutral_app_action_policy",
      priority: 91,
      content: providerNeutralActionPromptPolicy(),
    },
    {
      name: "available_tasks",
      priority: 90,
      content: actionCatalog.map((action) => ({
        name: action.name,
        description: action.description,
        risk: action.risk,
        side_effects: action.side_effects,
        params_json_schema: action.params_json_schema,
      })),
    },
    { name: "active_visible_plan", priority: 80, content: input.active_plan ?? null },
    { name: "suggested_plan", priority: 70, content: input.suggested_plan ?? null },
    { name: "recent_outcomes", priority: 60, content: input.recent_outcomes ?? [] },
    { name: "memories", priority: 50, content: input.memories ?? [] },
    { name: "session_graph_projection", priority: 40, content: input.session_graph_projection ?? null },
    ...(input.additional_sources ?? []),
  ].sort((a, b) => b.priority - a.priority);

  const sourceText = sources.map((source) => `## ${source.name}\n${clip(safeJson(source.content))}`).join("\n\n");

  return {
    sources,
    messages: [
      {
        role: "system",
        content: [
          "You are the Next Task Isolation Controller for an AI coding platform.",
          "Choose exactly one next task. Do not execute tools, write code, or create a full plan.",
          "The platform loop is: observe current state -> choose one next task -> platform validates -> platform executes -> observe result -> repeat.",
          "Choose exactly one decision: execute, find_out_more, ask_user, or stop.",
          "execute means perform a known task now.",
          "find_out_more means perform a read-only or low-risk task to increase certainty.",
          "ask_user means ask for missing information only when tools cannot materially improve certainty.",
          "stop means the goal is satisfied, blocked, cancelled, unsafe to continue, or waiting for user input.",
          "Be conservative. Prefer find_out_more over guessing. Prefer ask_user only when available tools cannot materially improve certainty.",
          "Do not modify files unless the requested change, target, and success criteria are clear.",
          "Do not run commands unless the command is known, scoped, and relevant.",
          "Do not repeat a failed action with the same inputs unless new information changes the expected result.",
          "Only choose task_name values from available_tasks, except stop may use task_name=stop.",
          "If visible_tasks is present, no other task names are available.",
          "If visible_tasks contains only session.route_prompt, this is a routing pass; return decision=execute and task_name=session.route_prompt.",
          "For app automation, use only provider-neutral root task names from available_tasks, such as email.create, email.search, email.send, message.send, issue.create, calendar_event.create, repository.search, spreadsheet_row.append, page.create, contact.create, browser_task.perform, or visual_browser_task.perform.",
          "Do not use provider-specific or app-specific names such as gmail.create_email, outlook.create_email, slack.send_message, discord.send_message, github.create_issue, jira.create_issue, or google_calendar.create_event as task_name.",
          "Put provider specificity in params using the correct provider parameter, for example email_provider, message_provider, issue_provider, calendar_provider, repository_provider, spreadsheet_provider, page_provider, contact_provider, or browser_provider.",
          "If a legacy app catalog action is useful for downstream routing, put it in params.catalog_action_id. If an execution vendor route is preferred, put it in params.automation_vendor.",
          "Certainty means confidence that the selected next task is the right next task, not confidence that the whole user goal is solved.",
          "Minimum certainty thresholds: read_only >= 0.55, execution >= 0.75, modification >= 0.85, external_side_effect >= 0.95 with explicit platform approval.",
          "If certainty is below the threshold for the selected task stakes, choose a lower-stakes find_out_more task or ask_user.",
          "Put all executable details in params, not only in reason or progress_note.",
          "Return strict JSON only with keys: decision, task_name, params, certainty, stakes, risk, reason, progress_note, missing_information, expected_result, success_criteria, forbidden_actions.",
        ].join("\n"),
      },
      {
        role: "user",
        content: sourceText,
      },
    ],
  };
}
