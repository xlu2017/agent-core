import { buildRecommendNextPrompt as buildBaseRecommendNextPrompt } from "./promptBuilder.js";
import { narrationPromptPolicy } from "./narrationPromptPolicy.js";
import type { RecommendNextPromptInput, RecommendNextPromptMessages, RecommendNextPromptSource } from "./types.js";

export function buildRecommendNextPrompt(input: RecommendNextPromptInput): RecommendNextPromptMessages {
  const base = buildBaseRecommendNextPrompt(input);
  const narrationSource: RecommendNextPromptSource = {
    name: "narration_policy",
    priority: 94,
    content: narrationPromptPolicy(),
  };
  return {
    sources: [...base.sources, narrationSource].sort((a, b) => b.priority - a.priority),
    messages: base.messages.map((message, index) => {
      if (index !== 0 || message.role !== "system") return message;
      return {
        ...message,
        content: `${message.content}\nEvery next task, including stop, can include params.narration: short frontend-facing prose that describes the immediate next action or why work is stopping without claiming unfinished work is complete. Narration must not mention model names, model providers, or internal routing services.`,
      };
    }),
  };
}
