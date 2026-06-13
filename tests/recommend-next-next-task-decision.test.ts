import { describe, expect, it } from "vitest";
import type { LLMClient, LLMResponse } from "../src/llm/LLMClient.js";
import type { ActionSchema } from "../src/providers/ActionProvider.js";
import type { ActionDefinition, ActionKnowledgeProvider, ActionRecommendationContext } from "../src/providers/ActionKnowledgeProvider.js";
import { recommendNext } from "../src/actions/recommend-next/engine.js";
import { RecommendNextInput } from "../src/schemas/actions.js";

const actions: ActionDefinition[] = [
  { name: "grep", description: "Search text.", params_json_schema: {}, output_json_schema: {}, risk: "low", side_effects: [], requires_platform_validation: true },
  { name: "ask_user", description: "Ask user.", params_json_schema: {}, output_json_schema: {}, risk: "low", side_effects: [], requires_platform_validation: true },
  { name: "session.route_prompt", description: "Route prompt.", params_json_schema: {}, output_json_schema: {}, risk: "low", side_effects: [], requires_platform_validation: true },
];

class StaticLlm implements LLMClient {
  readonly provider = "static";
  constructor(private readonly content: string) {}
  async chat(): Promise<LLMResponse> {
    return { content: this.content, usage: null, model: "static", latency_ms: 0 };
  }
}

const provider = {
  name: "test-provider",
  status: "mock" as const,
  register: async (schema: ActionSchema) => schema,
  list: async (): Promise<ActionSchema[]> => [],
  get: async (): Promise<ActionSchema | null> => null,
  validate: async () => ({ valid: true, errors: [] }),
  execute: async () => ({ success: true, output: {}, duration_ms: 0, execution_mode: "mock" as const }),
  listActions: async () => actions,
  getAction: async (name: string) => actions.find((action) => action.name === name) ?? null,
  recommendNextActions: async () => [],
  buildPlan: async () => ({ task_type: "test", steps: [], state: { current_action: null, completed_actions: [], known_risks: [], missing_context: [] } }),
  validatePlan: async () => ({ valid: true, errors: [], step_results: [] }),
  recordActionOutcome: async () => ({ id: "o1", session_id: "s1", action_name: "grep", params: {}, status: "succeeded" as const, output: {}, duration_ms: 0, executor: "test", created_at: "1970-01-01T00:00:00.000Z" }),
  getOutcomes: async () => [],
  getActionStats: async () => ({ total: 0, succeeded: 0, failed: 0, blocked: 0, avg_duration_ms: 0 }),
} satisfies ActionKnowledgeProvider;

const context: ActionRecommendationContext = {
  task_type: "implementation",
  current_action: "inspect",
  completed_actions: [],
  context: { session_id: "s1" },
};

describe("recommend-next next-task decision contract", () => {
  it("maps a next-task decision to the legacy recommendation field", async () => {
    const llmClient = new StaticLlm(JSON.stringify({
      decision: "execute",
      task_name: "grep",
      params: { pattern: "TODO" },
      certainty: 0.82,
      stakes: "read_only",
      risk: "low",
      reason: "Search first.",
      missing_information: [],
      expected_result: "Search results are available.",
      success_criteria: ["A result is returned."],
      forbidden_actions: [],
    }));

    const result = await recommendNext({ context, provider, llmClient });

    expect(result.source).toBe("llm_next_task_decision");
    expect(result.next_task_decision?.task_name).toBe("grep");
    expect(result.recommendation?.action_name).toBe("grep");
    expect(result.recommendation?.confidence).toBe(0.82);
  });

  it("keeps stop as terminal", async () => {
    const llmClient = new StaticLlm(JSON.stringify({
      decision: "stop",
      task_name: "stop",
      params: {},
      certainty: 0.91,
      stakes: "read_only",
      risk: "low",
      reason: "Finished.",
      missing_information: [],
      expected_result: "No next action is emitted.",
      success_criteria: ["No recommendation exists."],
      forbidden_actions: [],
    }));

    const result = await recommendNext({ context, provider, llmClient });

    expect(result.next_task_decision?.decision).toBe("stop");
    expect(result.recommendation).toBeNull();
    expect(result.recommendations).toEqual([]);
  });

  it("normalizes visible actions into context", () => {
    const parsed = RecommendNextInput.parse({
      task_type: "unknown",
      current_action: "session.route_prompt",
      completed_actions: [],
      visible_actions: ["session.route_prompt"],
      context: { session_id: "s1" },
    });

    expect(parsed.context.visible_actions).toEqual(["session.route_prompt"]);
  });
});
