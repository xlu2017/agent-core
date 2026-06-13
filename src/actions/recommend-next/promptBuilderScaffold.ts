import type { RecommendNextPromptInput, RecommendNextPromptMessages, RecommendNextPromptSource } from "./types.js";

type PromptSectionKind =
  | "contract"
  | "current_state"
  | "actions"
  | "plan"
  | "history"
  | "memory"
  | "session_graph"
  | "policy"
  | "output_schema"
  | "diagnostics";

export interface RenderedPromptSection {
  name: string;
  kind: PromptSectionKind;
  priority: number;
  token_budget_hint: number;
  content: string;
}

export interface PromptInspection {
  sections: RenderedPromptSection[];
  source_names: string[];
  total_characters: number;
}

const DEFAULT_SECTION_BUDGETS: Record<PromptSectionKind, number> = {
  contract: 900,
  current_state: 1800,
  actions: 4500,
  plan: 3500,
  history: 3000,
  memory: 1800,
  session_graph: 2600,
  policy: 1400,
  output_schema: 1200,
  diagnostics: 1200,
};

const SOURCE_TO_KIND: Record<string, PromptSectionKind> = {
  current_context: "current_state",
  action_catalog: "actions",
  active_visible_plan: "plan",
  suggested_plan: "plan",
  recent_outcomes: "history",
  memories: "memory",
  session_graph_projection: "session_graph",
  policy_and_authorization: "policy",
};

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? null, null, 2);
  } catch {
    return JSON.stringify({ unavailable: true, reason: "source could not be JSON serialized" }, null, 2);
  }
}

function clip(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 28))}\n...<truncated ${value.length - max} chars>`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function normalizeActionCatalog(input: RecommendNextPromptInput): unknown[] {
  return input.action_catalog.map((action) => ({
    name: action.name,
    description: action.description,
    risk: action.risk,
    side_effects: action.side_effects,
    params_json_schema: action.params_json_schema,
  }));
}

function extractPolicyContext(input: RecommendNextPromptInput): Record<string, unknown> {
  const context = asRecord(input.context.context);
  return {
    requires_platform_validation: true,
    advisory_only: true,
    executor_must_not_follow_plan_directly: true,
    plan_is_ui_state: true,
    recommend_next_is_only_executable_source: true,
    policy_hints: context.policy_hints ?? context.policy ?? null,
    automation_settings: context.automation_settings ?? null,
    authorization_state: context.authorization_state ?? null,
  };
}

function buildSources(input: RecommendNextPromptInput): RecommendNextPromptSource[] {
  const contextRecord = asRecord(input.context.context);
  return [
    {
      name: "current_context",
      priority: 100,
      content: {
        task_type: input.context.task_type,
        current_action: input.context.current_action ?? null,
        completed_actions: input.context.completed_actions,
        context: input.context.context,
      },
    },
    { name: "action_catalog", priority: 95, content: normalizeActionCatalog(input) },
    { name: "policy_and_authorization", priority: 92, content: extractPolicyContext(input) },
    { name: "active_visible_plan", priority: 88, content: input.active_plan ?? null },
    { name: "suggested_plan", priority: 82, content: input.suggested_plan ?? null },
    { name: "recent_outcomes", priority: 76, content: input.recent_outcomes ?? contextRecord.recent_outcomes ?? [] },
    { name: "memories", priority: 62, content: input.memories ?? contextRecord.memories ?? [] },
    { name: "session_graph_projection", priority: 58, content: input.session_graph_projection ?? contextRecord.session_graph_projection ?? null },
    ...(input.additional_sources ?? []),
  ].sort((a, b) => b.priority - a.priority);
}

function renderSourceSection(source: RecommendNextPromptSource): RenderedPromptSection {
  const kind = SOURCE_TO_KIND[source.name] ?? "diagnostics";
  const tokenBudget = DEFAULT_SECTION_BUDGETS[kind];
  const raw = typeof source.content === "string" ? source.content : safeJson(source.content);
  return {
    name: source.name,
    kind,
    priority: source.priority,
    token_budget_hint: tokenBudget,
    content: clip(raw, tokenBudget * 4),
  };
}

function renderSections(sources: RecommendNextPromptSource[]): RenderedPromptSection[] {
  return sources.map(renderSourceSection).sort((a, b) => b.priority - a.priority);
}

function renderSectionText(sections: RenderedPromptSection[]): string {
  return sections.map((section) => [
    `## ${section.name}`,
    `kind: ${section.kind}`,
    `priority: ${section.priority}`,
    `budget_hint_tokens: ${section.token_budget_hint}`,
    section.content,
  ].join("\n")).join("\n\n");
}

function buildSystemContract(): string {
  return [
    "You are the recommend-next engine for an autonomous coding platform.",
    "Your output is advisory, but it is the only advisory output the execution layer may use to decide the next executable action.",
    "Choose exactly one next action from the action catalog. Do not return a multi-step plan.",
    "The visible plan is UI/advisory state. It can guide prioritization, but the executor must follow your single next-action decision, not the plan directly.",
    "If your selected action deviates from the active or suggested plan, set requires_plan_revision=true and explain the deviation.",
    "Prefer evidence-gathering actions when execution or modification certainty is insufficient.",
    "Never choose external side-effect actions such as commit, push, merge, deploy, or secret use unless the context explicitly indicates validation and authorization gates are satisfied.",
    "Do not repeat a failed action with identical params unless new evidence or a changed condition justifies the retry.",
    "Stop only when the user's goal is satisfied, blocked by policy, or no available action can improve certainty.",
  ].join("\n");
}

function buildDecisionHeuristics(): string {
  return [
    "Decision heuristics:",
    "1. Determine the active goal and whether the latest context changes it.",
    "2. Inspect recent outcomes before selecting a task. Outcomes are stronger than the visible plan.",
    "3. Use the active visible plan to preserve user-facing continuity, but revise the plan when reality diverges.",
    "4. Pick read-only investigation when the target file, command, repo, or state is unknown.",
    "5. Pick execution only for known safe commands or direct UI/runtime actions.",
    "6. Pick modification only after relevant code/context evidence exists.",
    "7. Pick external side effects only after validation and authorization are explicit in the prompt sources.",
    "8. Return plan_alignment=aligned when the chosen action corresponds to open visible-plan step ids.",
    "9. Return plan_alignment=deviating and requires_plan_revision=true when the chosen action is better than the visible plan's next step.",
  ].join("\n");
}

function buildOutputSchemaInstruction(): string {
  return [
    "Return strict JSON only. No Markdown. No surrounding prose.",
    "Required shape:",
    safeJson({
      action_name: "string from action catalog",
      params: {},
      confidence: 0.0,
      rationale: "short explanation grounded in prompt sources",
      plan_alignment: "aligned | partially_aligned | deviating | no_active_plan",
      aligned_plan_step_ids: ["plan_step_id"],
      deviation_reason: "required when plan_alignment is deviating",
      requires_plan_revision: false,
      progress_note: "short user-visible status note",
      expected_result: "what this action should produce",
      success_criteria: ["observable criterion"],
      forbidden_actions: ["actions that should not run next"],
      target_session_ids: ["session ids if known"],
      risk: "low | medium | high",
      stakes: "read_only | execution | modification | external_side_effect",
    }),
  ].join("\n");
}

export function buildComprehensiveRecommendNextPrompt(input: RecommendNextPromptInput): RecommendNextPromptMessages {
  const sources = buildSources(input);
  const sections = renderSections(sources);
  return {
    sources,
    messages: [
      { role: "system", content: [buildSystemContract(), "", buildDecisionHeuristics(), "", buildOutputSchemaInstruction()].join("\n") },
      {
        role: "user",
        content: [
          "# Recommend-next source packet",
          "Use these sources in priority order. Higher-priority sources should dominate when sources conflict.",
          "The action catalog defines allowed next actions. The visible plan does not define executable authority.",
          "",
          renderSectionText(sections),
        ].join("\n"),
      },
    ],
  };
}

export function inspectComprehensiveRecommendNextPrompt(input: RecommendNextPromptInput): PromptInspection {
  const sources = buildSources(input);
  const sections = renderSections(sources);
  return {
    sections,
    source_names: sources.map((source) => source.name),
    total_characters: sections.reduce((sum, section) => sum + section.content.length, 0),
  };
}
