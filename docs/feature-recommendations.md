# Feature Recommendations — Top 5 by Impact

## Methodology

This analysis compares what is **already built** (source code, routes, tests, docs) against what is **documented as planned or missing** (architecture docs, implementation plan, phase-1 scope, provider audit, memory roadmap, platform boundary docs). Each recommendation is prioritized by:

1. **User/Platform impact** — how much value it unlocks for the downstream platform (jubilant-goggles)
2. **Architectural gap** — how large the missing piece is relative to the documented vision
3. **Effort vs. payoff** — implementation complexity vs. capability gained

---

## ✅ What's Already Built (Current State)

### Fully implemented and tested (475 tests passing):

| Module | Status | Key Files |
|--------|--------|-----------|
| **Memory CRUD** | ✅ Complete | `memory/routes.ts`, `SQLiteHybridMemoryProvider`, FTS5 search |
| **Context Tree** | ✅ Complete | `context/routes.ts`, onboard/search/link/promote |
| **Action Registry** | ✅ Complete | `actions/routes.ts`, `defaults.ts`, `actionSchemas.ts` |
| **Action Validation** | ✅ Complete | Zod schemas, `validate` endpoint |
| **Mock Execution** | ✅ Complete | `mock-execute`, `simulate-pipeline` |
| **Action Pipeline** | ✅ Complete | 5-stage pipeline (scope→lookup→permission→validate→invoke) |
| **LLM-First Planning** | ✅ Complete | `ActionPlanner.ts`, plan generation, repair, validation |
| **Plan Validation** | ✅ Complete | `actionPlanValidator.ts`, `validate-plan` endpoint |
| **Letta Rule Solver** | ✅ Complete | `lettaRuleSolver.ts` — full TS port of Letta's ToolRulesSolver |
| **Trace Store** | ✅ Complete | `traces/routes.ts`, tool-call + skill-run traces |
| **Session Management** | ✅ Complete | CRUD, events, timeline, close |
| **Task Classifier** | ✅ Complete | Keyword-based mock + LLM path |
| **Policy Matching** | ✅ Complete | `policy.ts`, `PolicyMatcherProvider`, seed policies |
| **Mock Platform** | ✅ Complete | repos, worktrees, executors, policy, approvals, commits |
| **Provider Registry** | ✅ Complete | 9 provider slots with capability matrix |
| **Auth Middleware** | ✅ Complete | API key via `x-api-key` or `Bearer` |
| **Rate Limiting** | ✅ Complete | Sliding-window in-memory |
| **OpenAPI** | ✅ Complete | `@fastify/swagger` + `@fastify/swagger-ui` |
| **LLM Clients** | ✅ Complete | DeepSeek + Gemini clients with JSON mode |
| **Mem0 Adapter** | ✅ Complete | Embedded worker + REST transport |
| **Benchmarks** | ✅ Complete | Retrieval, parity, performance, concurrency |
| **LLM Evaluation** | ✅ Complete | Classifier + extraction evals with fixtures |
| **Provider Vendoring** | ✅ Complete | 9 providers audited, integration strategies documented |

### Key architectural decisions already made:
- **Advisory-only boundary** — agent-core never authorizes or executes
- **Provider registry pattern** — mock → direct → adapter → sidecar → reference
- **LLM-first planning** — replaces classifier-first routing
- **Letta rule solver port** — direct TS port completed
- **Native SQLite hybrid memory** — default backend (not mem0)

---

## 🔴 Recommendation #1: LLM-Powered Memory Extraction (Highest Impact)

### What's missing
The current memory extraction (`/memory/extract`) uses **keyword-based heuristics** — it splits text on sentence boundaries and scores sentences by keyword matches ("always", "never", "must", etc.). This is explicitly called out as "Phase 2" in the implementation plan and "Partial" in the memory roadmap.

There is an LLM extraction path behind `ENABLE_LLM_EXTRACT=true`, but it's gated behind a feature flag and only uses DeepSeek (not Gemini). It's also not integrated into the session close flow — extraction must be called manually.

### Why high impact
1. **Memory quality is the core value proposition** — agent-core's primary job is durable memory. Keyword extraction produces low-quality, noisy candidates.
2. **The LLM infrastructure already exists** — `DeepSeekClient`, `GeminiClient`, `llmJson()` are all built and tested. The extraction prompt is already written.
3. **Unlocks downstream capabilities** — better extraction feeds better retrieval, better context assembly, better planning.
4. **Documented as the #1 Phase 2 item** — "Replace keyword extraction with LLM-powered extraction (mem0 patterns)"

### What to build
1. Make LLM extraction the **default path** (remove `ENABLE_LLM_EXTRACT` flag)
2. Add Gemini support alongside DeepSeek
3. **Auto-extract on session close** — when a session is closed, automatically run extraction on session events/traces
4. Add extraction quality metrics (precision/recall against fixture baselines)
5. Add configurable extraction triggers (per-action, per-event-type)

### Effort estimate
- **Medium** (2-3 days) — LLM clients exist, prompts exist, integration points exist
- Tests: Update extraction fixtures, add auto-extract integration tests

---

## 🟠 Recommendation #2: Vector Similarity Search (Native)

### What's missing
Memory search currently uses **FTS5/BM25 keyword search** only. The memory roadmap explicitly calls vector-style similarity search as "Prototype" status and hybrid retrieval as "Active". The `SQLiteHybridMemoryProvider` has a `searchSimilar()` method that uses the configured embedding provider, but there's no production-grade vector index.

The `EmbeddingProvider` interface exists with adapters for `LocalEmbeddingProvider`, `OpenAICompatibleEmbeddingProvider`, and `MockEmbeddingProvider`, but the vector search path is not hardened for production.

### Why high impact
1. **Semantic search is essential for memory retrieval** — keyword search misses semantically related memories
2. **The embedding infrastructure is already scaffolded** — provider interface, local embedding, OpenAI-compatible adapter all exist
3. **Hybrid search (BM25 + vector) is the industry standard** — mem0, Chroma, and Pinecone all use this pattern
4. **Documented as Sprint 2 priority** — "Retrieval substrate hardening" with Recall@K, MRR, nDCG gates

### What to build
1. **SQLite VSS extension** — add `sqlite-vss` or implement a simple vector index using SQLite BLOBs + cosine similarity
2. **Production-grade hybrid scoring** — weighted combination of BM25 score + cosine similarity
3. **Embedding provider auto-detection** — use local embeddings by default, OpenAI-compatible when configured
4. **Benchmark gates** — ensure Recall@1/3/5, MRR, nDCG@5 meet or exceed current baselines
5. **Fallback chain** — vector search → BM25 → LIKE (graceful degradation)

### Effort estimate
- **Medium-High** (3-5 days) — embedding providers exist, but vector index integration is non-trivial
- Tests: Extend retrieval benchmarks, add hybrid search parity tests

---

## 🟡 Recommendation #3: Session Timeline & Event Streaming

### What's missing
The current session timeline (`GET /sessions/:session_id/timeline`) returns a merged list of events and traces. There is **no streaming or live-feed capability**. The platform boundary doc explicitly mentions "Live feed (truthful event stream)" as a jubilant-goggles responsibility, but agent-core should provide the event sourcing substrate.

The `SessionProvider` interface has `addEvent()` and `getTimeline()`, but there's no:
- Server-Sent Events (SSE) endpoint for live streaming
- Event sourcing / CQRS pattern
- Pagination or cursor-based iteration for long timelines
- Webhook/callback support for async platform notification

### Why high impact
1. **The platform needs real-time visibility** — jubilant-goggles needs to show users what's happening during execution
2. **SSE is low-effort, high-value** — Fastify has built-in SSE support via `@fastify/sse`
3. **Unlocks platform UX** — live status feeds, progress bars, real-time trace visualization
4. **Documented in platform boundary** — "Live feed (truthful event stream)" is a core platform contract

### What to build
1. **SSE endpoint** — `GET /sessions/:session_id/events/stream` that pushes events as they happen
2. **Cursor-based pagination** — `GET /sessions/:session_id/timeline?cursor=...&limit=50`
3. **Event sourcing store** — append-only event log with replay capability
4. **Webhook registration** — `POST /sessions/:session_id/webhooks` for async platform notification
5. **Timeline filtering** — filter by event type, action name, time range

### Effort estimate
- **Low-Medium** (1-2 days) — SSE is well-supported in Fastify, event store is already SQLite-backed
- Tests: Add SSE integration tests, pagination tests

---

## 🟢 Recommendation #4: Progressive Skill Learning (Cognee Patterns)

### What's missing
The architecture doc mentions "progressive skill learning" as a Phase 2 item (reference: cognee). Currently, agent-core has no mechanism to:
- Learn from past sessions to improve future recommendations
- Track skill proficiency or success rates
- Adjust action recommendations based on historical outcomes
- Accumulate "lessons learned" across sessions

The `outcomeStore.ts` records action outcomes (success/failure, duration), but this data is **not used** to influence future planning or recommendations.

### Why high impact
1. **The data already exists** — `action_audits` table, `outcomeStore`, traces all contain historical execution data
2. **Self-improving system** — the platform gets smarter with each session without manual tuning
3. **Differentiator** — most agent frameworks don't learn from past outcomes
4. **Documented in architecture** — "progressive skill learning (cognee patterns)" is a Phase 2 item

### What to build
1. **Outcome analytics** — aggregate success/failure rates per action, per task type, per repo
2. **Skill scoring** — track which action sequences produce the best outcomes for each task type
3. **Recommendation weighting** — bias plan generation toward high-success-rate action sequences
4. **Lesson extraction** — extract "lessons learned" from failed action sequences and store as memories
5. **Progressive context** — include historical outcome summaries in planning prompts

### Effort estimate
- **Medium** (2-3 days) — outcome data exists, analytics are SQL queries, integration with planner is straightforward
- Tests: Add outcome analytics tests, recommendation weighting tests

---

## 🔵 Recommendation #5: Multi-Tenant Isolation & Scoped Access

### What's missing
The current implementation has **no multi-tenant isolation**. All memories, sessions, traces, and actions are stored in a single SQLite database with no tenant/user partitioning beyond the `scope` and `scope_id` fields on memories. The phase-1 scope explicitly lists "Multi-tenant isolation" as out of scope.

However, the architecture envisions agent-core as a shared service used by jubilant-goggles across many users and repos. Without tenant isolation:
- User A could query User B's memories (if they know the session_id)
- There's no data partitioning at the database level
- The auth middleware is a single shared API key

### Why high impact
1. **Required for production deployment** — no production service can operate without tenant isolation
2. **The scope/scoping fields already exist** — memories have `scope` and `scope_id`, sessions have `repo_id`
3. **Auth middleware is already scaffolded** — API key auth exists, just needs per-tenant key management
4. **Documented as future need** — "Multi-tenant isolation" is explicitly called out

### What to build
1. **Tenant-aware provider wrappers** — each provider filters by tenant context (user_id, org_id)
2. **Per-tenant API keys** — replace single `AGENT_CORE_API_KEY` with a key store (can be SQLite-based)
3. **Row-level security** — all queries filter by tenant scope automatically
4. **Tenant isolation tests** — verify User A cannot access User B's data
5. **Rate limiting per tenant** — extend rate limiter to track per-tenant quotas

### Effort estimate
- **Medium** (2-3 days) — scoping fields exist, auth middleware exists, provider pattern supports wrapping
- Tests: Add tenant isolation integration tests, key management tests

---

## Summary Priority Matrix

| # | Feature | Impact | Effort | Risk | Dependencies |
|---|---------|--------|--------|------|-------------|
| 1 | LLM-Powered Memory Extraction | 🔴 High | Medium | Low | LLM clients exist |
| 2 | Vector Similarity Search | 🟠 High | Med-High | Medium | Embedding providers exist |
| 3 | Session Timeline Streaming | 🟡 Medium | Low-Med | Low | Fastify SSE support |
| 4 | Progressive Skill Learning | 🟢 Medium | Medium | Low | Outcome data exists |
| 5 | Multi-Tenant Isolation | 🔵 High | Medium | Medium | Scoping fields exist |

## Quick Wins (if you want something in 1 day)

1. **SSE streaming** (#3) — Fastify has built-in SSE, can be done in a few hours
2. **Auto-extract on session close** (part of #1) — ~half day, high visible impact
3. **Outcome analytics endpoint** (part of #4) — ~half day, enables data-driven decisions

## Architectural Note

All five recommendations are **additive** — they extend existing interfaces and providers without breaking changes. The provider registry pattern ensures that each feature can be implemented behind its existing interface, with mock fallbacks for testing.
