import { buildRecommendNextPrompt as buildBaseRecommendNextPrompt } from "./promptBuilder.js";
import { narrationPromptPolicy } from "./narrationPromptPolicy.js";
import type { RecommendNextPromptInput, RecommendNextPromptMessages, RecommendNextPromptSource } from "./types.js";

function safeJson(value: unknown): string {
  return JSON.stringify(value ?? null, null, 2);
}

export function buildRecommendNextPrompt(input: RecommendNextPromptInput): RecommendNextPromptMessages {
  const base = buildBaseRecommendNextPrompt(input);
  const narrationSource: RecommendNextPromptSource = {
    name: "narration_policy",
    priority: 94,
    content: narrationPromptPolicy(),
  };
  const narrationBlock = `\n\n## narration_policy\n${safeJson(narrationSource.content)}`;
  return {
    sources: [...base.sources, narrationSource].sort((a, b) => b.priority - a.priority),
    messages: base.messages.map((message, index) => {
      if (index === 0 && message.role === "system") {
        return {
          ...message,
          content: `${message.content}\nEvery next task, including stop, can include params.narration: short frontend-facing prose that describes the immediate next action or why work is stopping without claiming unfinished work is complete. Narration must not mention model names, model providers, or internal routing services.`,
        };
      }
      if (index === 1 && message.role === "user") {
        return {
          ...message,
          content: `${message.content}${narrationBlock}`,
        };
      }
      return message;
    }),
  };
}
