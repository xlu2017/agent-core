import type { ActionDefinition, ActionRecommendation, ActionRecommendationContext } from "../../providers/ActionKnowledgeProvider.js";

/**
 * Graph prompt routing must be LLM-backed.
 *
 * The control plane treats graph prompt routing as a user-facing chat decision
 * that can spawn work, goals, or inline chat. Returning a deterministic fallback
 * here hides LLM unavailability and can route repo-context questions incorrectly.
 * Keep the function for engine compatibility, but return null so callers fail
 * closed when no valid LLM-backed route is available.
 */
export function graphPromptRouteFallbackRecommendation(_context: ActionRecommendationContext, _catalog: ActionDefinition[]): ActionRecommendation | null {
  return null;
}
