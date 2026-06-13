# Comprehensive recommend-next prompt builder scaffold

## Intent

`promptBuilder.ts` is the long-term home for constructing the full recommend-next prompt. The prompt needs to include all material that can affect the next action decision while preserving the invariant that recommend-next returns exactly one executable action.

A comprehensive scaffold has been added in:

```text
src/actions/recommend-next/promptBuilderScaffold.ts
```

It is currently a companion scaffold so existing imports keep working. The next cleanup should either replace `promptBuilder.ts` with this implementation or make `promptBuilder.ts` re-export `buildComprehensiveRecommendNextPrompt` as `buildRecommendNextPrompt`.

## Sources included

The scaffold builds a prioritized source packet from:

- current context
- action catalog
- policy and authorization context
- active visible plan
- suggested plan
- recent outcomes
- memories
- session graph projection
- additional future sources

## Prompt sections

Sources are normalized into sections with:

- section name
- section kind
- priority
- token budget hint
- clipped JSON/text content

Section kinds:

```text
contract
current_state
actions
plan
history
memory
session_graph
policy
output_schema
diagnostics
```

## Decision contract

The system message tells the model:

- choose exactly one next action
- use only the action catalog for executable actions
- treat the visible plan as advisory UI state
- prefer evidence-gathering when certainty is low
- do not repeat failed actions without new evidence
- do not choose external side effects unless validation and authorization are explicit
- mark plan deviations with `requires_plan_revision=true`

## Output contract

The prompt demands strict JSON with fields for:

- action_name
- params
- confidence
- rationale
- plan_alignment
- aligned_plan_step_ids
- deviation_reason
- requires_plan_revision
- progress_note
- expected_result
- success_criteria
- forbidden_actions
- target_session_ids
- risk
- stakes

## Inspection support

The scaffold exports:

```ts
inspectComprehensiveRecommendNextPrompt(input)
```

This returns source names, rendered sections, and total character count so future tests and UI diagnostics can inspect prompt composition without calling an LLM.

## Next integration step

Replace or wrap the current `buildRecommendNextPrompt` implementation with `buildComprehensiveRecommendNextPrompt` after type checks are available locally. Then update `engine.ts` to consume the richer prompt output without changing its public contract.
