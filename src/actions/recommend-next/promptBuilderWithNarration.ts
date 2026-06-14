import { buildRecommendNextPrompt as buildBaseRecommendNextPrompt } from "./promptBuilder.js";
import { narrationPromptPolicy } from "./narrationPromptPolicy.js";
import type { RecommendNextPromptInput, RecommendNextPromptMessages, RecommendNextPromptSource } from "./types.js";

function safeJson(value: unknown): string {
  return JSON.stringify(value ?? null, null, 2);
}

function graphRouteOverridePolicy() {
  return {
    priority: "supersedes older graph_session_prompt_routing_policy route descriptions when there is a conflict",
    continue_active: "Use continue_active when repository context is attached and the user's explanatory prompt may depend on repository contents. The platform must inspect repository context before answering.",
    question_only: "Use question_only only for general chat or explanations where no repository lookup, work item, or new goal is needed.",
    examples: [
      {
        prompt: "Why is the world round?",
        has_repo_context: true,
        route: "continue_active",
        reason: "Repository lore, code, assets, or configuration may define the answer.",
      },
      {
        prompt: "Who are you?",
        has_repo_context: true,
        route: "question_only",
        reason: "This is personal/meta chat and should not inspect repository context.",
      },
    ],
  };
}

export function buildRecommendNextPrompt(input: RecommendNextPromptInput): RecommendNextPromptMessages {
  const base = buildBaseRecommendNextPrompt(input);
  const narrationSource: RecommendNextPromptSource = {
    name: "narration_policy",
    priority: 94,
    content: narrationPromptPolicy(),
  };
  const graphRouteOverrideSource: RecommendNextPromptSource = {
    name: "graph_route_override_policy",
    priority: 96,
    content: graphRouteOverridePolicy(),
  };
  const appendedPolicyBlock = [graphRouteOverrideSource, narrationSource]
    .map((source) => `## ${source.name}\n${safeJson(source.content)}`)
    .join("\n\n");
  return {
    sources: [...base.sources, graphRouteOverrideSource, narrationSource].sort((a, b) => b.priority - a.priority),
    messages: base.messages.map((message, index) => {
      if (index === 0 && message.role === "system") {
        return {
          ...message,
          content: `${message.content}\nEvery next task, including stop, can include params.narration: short frontend-facing prose that describes the immediate next action or why work is stopping without claiming unfinished work is complete. Narration must not mention model names, model providers, or internal routing services. Later prompt sources override earlier route descriptions when they conflict.`,
        };
      }
      if (index === 1 && message.role === "user") {
        return {
          ...message,
          content: `${message.content}\n\n${appendedPolicyBlock}`,
        };
      }
      return message;
    }),
  };
}
