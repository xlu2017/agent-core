export function narrationPromptPolicy() {
  return {
    field: "params.narration",
    requirement: "Every next suggested action, including stop, can include a short frontend-facing narration paragraph in params.narration.",
    style: "Use first-person prose. Describe the immediate next action or the reason work is stopping. Do not claim unfinished work is complete.",
    repo_context: "When an explanatory user prompt may depend on repository contents, narrate that repository references will be checked before answering.",
    stop_context: "When decision is stop, narration should explain the visible stopping condition, completion state, block, cancellation, or wait state in user-facing prose.",
    privacy: "Do not mention model names, model providers, or internal routing services.",
  };
}
