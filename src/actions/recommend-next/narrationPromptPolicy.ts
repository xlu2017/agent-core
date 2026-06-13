export function narrationPromptPolicy() {
  return {
    field: "params.narration",
    requirement: "Every non-stop next suggested action must include a short frontend-facing narration paragraph in params.narration.",
    style: "Use first-person prose. Describe the immediate next action. Do not claim the action is complete.",
    repo_context: "When an explanatory user prompt may depend on repository contents, narrate that repository references will be checked before answering.",
    privacy: "Do not mention model names, model providers, or internal routing services.",
  };
}
