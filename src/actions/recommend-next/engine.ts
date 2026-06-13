import type { LLMClient } from "../../llm/LLMClient.js";
import type { ActionDefinition, ActionKnowledgeProvider, ActionRecommendation, ActionRecommendationContext } from "../../providers/ActionKnowledgeProvider.js";
import { NextActionWithSessionUpdateSchema, type NextActionWithSessionUpdate } from "../../sessions/sessionUpdateProposal.js";
import { coordinateRecommendNext } from "./planCoordinator.js";
import { buildRecommendNextPrompt } from "./promptBuilderWithNarration.js";
import { graphPromptRouteFallbackRecommendation } from "./graphPromptRouteFallback.js";
import type { RecommendNextWithPlanOutput } from "./types.js";

export interface RecommendNextEngineInput {
  context: ActionRecommendationContext;
  provider: ActionKnowledgeProvider;
  llmClient?: LLMClient | null;
  visible_actions?: string[];
  active_plan?: unknown;
  suggested_plan?: unknown;
  recent_outcomes?: unknown[];
  memories?: unknown[];
  session_graph_projection?: unknown;
}

export interface RecommendNextEngineResult {
  recommendation: ActionRecommendation | null;
  recommendations: ActionRecommendation[];
  next_task_decision?: NextActionWithSessionUpdate;
  plan_decision?: RecommendNextWithPlanOutput;
  prompt_messages?: Array<{ role: "system" | "user"; content: string }>;
  active_plan?: unknown;
  suggested_plan?: unknown;
  source: "llm_next_task_decision" | "llm_recommend_next" | "provider_recommend_next" | "engine_prompt_route_fallback";
  advisory_only: true;
  requires_platform_validation: true;
}

function normalizeActionName(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "ask_user";
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function contextVisibleActions(context: ActionRecommendationContext): string[] {
  const raw = context.context["visible_actions"];
  return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}

function effectiveVisibleActions(input: RecommendNextEngineInput): string[] {
  return input.visible_actions && input.visible_actions.length > 0 ? input.visible_actions : contextVisibleActions(input.context);
}

function visibleCatalog(catalog: ActionDefinition[], visibleActions: string[]): ActionDefinition[] {
  const visible = new Set(visibleActions);
  if (visible.size === 0) return catalog;
  return catalog.filter((action) => visible.has(action.name));
}

function parseNextTaskDecision(raw: Record<string, unknown>): NextActionWithSessionUpdate | null {
  const parsed = NextActionWithSessionUpdateSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function questionFromDecision(decision: NextActionWithSessionUpdate): string {
  const explicit = decision.params["question"];
  if (typeof explicit === "string" && explicit.trim()) return explicit;
  const missing = decision.missing_information[0];
  if (missing) return `Please provide ${missing}.`;
  return decision.reason || "I need more information before continuing.";
}

function toRecommendationFromDecision(decision: NextActionWithSessionUpdate, catalog: ActionDefinition[]): ActionRecommendation | null {
  if (decision.decision === "stop") return null;

  let actionName = decision.task_name;
  let params = decision.params && typeof decision.params === "object" ? decision.params as Record<string, unknown> : {};
  let action = catalog.find((candidate) => candidate.name === actionName);

  if (decision.decision === "ask_user" && !action) {
    actionName = "ask_user";
    params = { question: questionFromDecision(decision) };
    action = catalog.find((candidate) => candidate.name === actionName);
  }

  return {
    action_name: actionName,
    params,
    schema_valid: Boolean(action),
    requires_platform_validation: true,
    requires_approval: false,
    confidence: decision.certainty,
    rationale: decision.reason,
  };
}

function toRecommendation(raw: Record<string, unknown>, catalog: ActionDefinition[]): ActionRecommendation {
  const actionName = normalizeActionName(raw.action_name ?? raw.next_action ?? raw.recommended_action);
  const action = catalog.find((candidate) => candidate.name === actionName);
  return {
    action_name: actionName,
    params: raw.params && typeof raw.params === "object" ? raw.params as Record<string, unknown> : {},
    schema_valid: Boolean(action),
    requires_platform_validation: true,
    requires_approval: false,
    confidence: typeof raw.confidence === "number" ? raw.confidence : typeof raw.certainty === "number" ? raw.certainty : 0.5,
    rationale: typeof raw.rationale === "string" ? raw.rationale : typeof raw.reason === "string" ? raw.reason : "recommend-next selected this action",
  };
}

function coordinateRecommendation(input: RecommendNextEngineInput, raw: Record<string, unknown>): RecommendNextWithPlanOutput {
  return coordinateRecommendNext({
    session_id: String(input.context.context.session_id ?? input.context.context["session_id"] ?? "unknown"),
    task_type: input.context.task_type,
    current_action: input.context.current_action,
    completed_actions: input.context.completed_actions,
    context: input.context.context,
    active_plan: input.active_plan as never,
    suggested_plan: input.suggested_plan as never,
    recent_action_outcomes: (input.recent_outcomes ?? []) as Record<string, unknown>[],
  }, raw);
}

export async function recommendNext(input: RecommendNextEngineInput): Promise<RecommendNextEngineResult> {
  const catalog = await input.provider.listActions();
  const visibleActions = effectiveVisibleActions(input);
  const filteredCatalog = visibleCatalog(catalog, visibleActions);
  const prompt = buildRecommendNextPrompt({
    context: input.context,
    action_catalog: catalog,
    visible_actions: visibleActions,
    active_plan: input.active_plan,
    suggested_plan: input.suggested_plan,
    recent_outcomes: input.recent_outcomes,
    memories: input.memories,
    session_graph_projection: input.session_graph_projection,
  });

  if (input.llmClient) {
    try {
      const response = await input.llmClient.chat(prompt.messages, { json_mode: true, temperature: 0 });
      const parsed = parseJsonObject(response.content);
      if (parsed) {
        const nextTaskDecision = parseNextTaskDecision(parsed);
        if (nextTaskDecision) {
          const recommendation = toRecommendationFromDecision(nextTaskDecision, filteredCatalog);
          const rawForPlan = recommendation
            ? { action_name: recommendation.action_name, params: recommendation.params, confidence: nextTaskDecision.certainty, rationale: nextTaskDecision.reason }
            : { action_name: nextTaskDecision.task_name, params: nextTaskDecision.params, confidence: nextTaskDecision.certainty, rationale: nextTaskDecision.reason };
          return {
            recommendation,
            recommendations: recommendation ? [recommendation] : [],
            next_task_decision: nextTaskDecision,
            plan_decision: recommendation ? coordinateRecommendation(input, rawForPlan) : undefined,
            prompt_messages: prompt.messages,
            active_plan: input.active_plan,
            suggested_plan: input.suggested_plan,
            source: "llm_next_task_decision",
            advisory_only: true,
            requires_platform_validation: true,
          };
        }

        const recommendation = toRecommendation(parsed, filteredCatalog);
        const planDecision = coordinateRecommendation(input, parsed);
        return {
          recommendation,
          recommendations: [recommendation],
          plan_decision: planDecision,
          prompt_messages: prompt.messages,
          active_plan: input.active_plan,
          suggested_plan: input.suggested_plan,
          source: "llm_recommend_next",
          advisory_only: true,
          requires_platform_validation: true,
        };
      }
    } catch {
      // Fall through to provider recommendation. The platform remains advisory-only.
    }
  }

  const routeRecommendation = graphPromptRouteFallbackRecommendation(input.context, filteredCatalog);
  if (routeRecommendation) {
    return {
      recommendation: routeRecommendation,
      recommendations: [routeRecommendation],
      prompt_messages: prompt.messages,
      active_plan: input.active_plan,
      suggested_plan: input.suggested_plan,
      source: "engine_prompt_route_fallback",
      advisory_only: true,
      requires_platform_validation: true,
    };
  }

  const recommendations = await input.provider.recommendNextActions(input.context);
  const visibleNames = new Set(visibleActions);
  const visibleRecommendations = visibleNames.size === 0 ? recommendations : recommendations.filter((item) => visibleNames.has(item.action_name));
  return {
    recommendation: visibleRecommendations[0] ?? null,
    recommendations: visibleRecommendations,
    prompt_messages: prompt.messages,
    active_plan: input.active_plan,
    suggested_plan: input.suggested_plan,
    source: "provider_recommend_next",
    advisory_only: true,
    requires_platform_validation: true,
  };
}
