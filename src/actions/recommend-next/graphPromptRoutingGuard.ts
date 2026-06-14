import type { ActionRecommendationContext } from "../../providers/ActionKnowledgeProvider.js";
import type { RecommendNextEngineInput, RecommendNextEngineResult } from "./engine.js";
import { recommendNext } from "./engine.js";

function contextVisibleActions(context: ActionRecommendationContext): string[] {
  const raw = context.context["visible_actions"];
  return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}

function effectiveVisibleActions(input: RecommendNextEngineInput): string[] {
  return input.visible_actions && input.visible_actions.length > 0 ? input.visible_actions : contextVisibleActions(input.context);
}

function isGraphPromptRoutingPass(input: RecommendNextEngineInput): boolean {
  const visibleActions = effectiveVisibleActions(input);
  return input.context.current_action === "session.route_prompt"
    || input.context.context["prompt_kind"] === "graph_session_followup"
    || (visibleActions.length === 1 && visibleActions[0] === "session.route_prompt");
}

export async function recommendNextWithGraphPromptRoutingGuard(input: RecommendNextEngineInput): Promise<RecommendNextEngineResult> {
  const graphPromptRoutingPass = isGraphPromptRoutingPass(input);
  if (graphPromptRoutingPass && !input.llmClient) {
    throw new Error("Graph prompt routing requires a configured LLM client.");
  }

  const result = await recommendNext(input);
  if (graphPromptRoutingPass && result.source !== "llm_next_task_decision" && result.source !== "llm_recommend_next") {
    throw new Error(`Graph prompt routing requires an LLM route decision, got ${result.source}.`);
  }
  return result;
}
