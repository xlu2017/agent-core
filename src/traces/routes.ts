import { FastifyInstance } from "fastify";
import { SessionCreateInput, SessionEventInput, SessionListInput, SessionCloseInput } from "../schemas/session.js";
import { ToolCallTraceInput, SkillRunTraceInput } from "../schemas/traces.js";
import { getProvider } from "../providers/registry.js";
import { isDeepSeekConfigured, isGeminiConfigured, DeepSeekClient, GeminiClient, llmJson } from "../llm/index.js";
import { MemoryExtractionResult } from "../schemas/memory.js";

export async function sessionRoutes(app: FastifyInstance): Promise<void> {
  app.post("/sessions", async (req, reply) => {
    const input = SessionCreateInput.parse(req.body);
    const session = await getProvider("session").create(input.repo_id);
    reply.code(201);
    return { id: session.id, repo_id: session.repo_id, status: session.status };
  });

  app.get("/sessions/:session_id", async (req) => {
    const { session_id } = req.params as { session_id: string };
    const session = await getProvider("session").get(session_id);
    if (!session) {
      return { error: "session not found" };
    }
    return session;
  });

  app.post("/sessions/:session_id/events", async (req, reply) => {
    const { session_id } = req.params as { session_id: string };
    const input = SessionEventInput.parse(req.body);
    const event = await getProvider("session").addEvent(session_id, input.event_type, input.data);
    reply.code(201);
    return { id: event.id, session_id, event_type: event.event_type };
  });

  app.get("/sessions", async (req) => {
    const query = req.query as Record<string, string>;
    const input = SessionListInput.parse(query);
    const sessions = await getProvider("session").list({
      status: input.status,
      repo_id: input.repo_id,
      limit: input.limit,
    });
    return { sessions };
  });

  app.post("/sessions/:session_id/close", async (req) => {
    const { session_id } = req.params as { session_id: string };
    const input = SessionCloseInput.parse(req.body ?? {});
    const session = await getProvider("session").close(session_id, input.summary);
    if (!session) return { error: "session not found" };

    // Auto-extract memories from session events on close (non-blocking)
    const llmConfigured = isDeepSeekConfigured() || isGeminiConfigured();
    if (llmConfigured && process.env.AUTO_EXTRACT_ON_CLOSE !== "false") {
      extractSessionMemories(session_id).catch((err) => {
        console.error(`[auto-extract] session ${session_id}:`, err);
      });
    }

    return session;
  });

  app.delete("/sessions/:session_id", async (req, reply) => {
    const { session_id } = req.params as { session_id: string };
    const deleted = await getProvider("session").delete(session_id);
    if (!deleted) return { error: "session not found" };
    reply.code(204);
    return;
  });

  app.get("/sessions/:session_id/timeline", async (req) => {
    const { session_id } = req.params as { session_id: string };
    const query = req.query as Record<string, string>;
    const cursor = query.cursor;
    const limit = Math.min(Number(query.limit) || 50, 1000);

    const timeline = await getProvider("session").getTimeline(session_id);

    // Apply cursor-based pagination
    let filtered = timeline;
    if (cursor) {
      const cursorIndex = timeline.findIndex((item) => item.id === cursor);
      if (cursorIndex >= 0) {
        filtered = timeline.slice(cursorIndex + 1);
      }
    }
    const page = filtered.slice(0, limit);
    const nextCursor = filtered.length > limit ? filtered[limit - 1]?.id : null;

    return {
      session_id,
      cursor,
      next_cursor: nextCursor,
      has_more: filtered.length > limit,
      events: page
        .filter((item) => item.type === "event")
        .map((item) => ({ id: item.id, created_at: item.timestamp, data: item.data })),
      traces: page
        .filter((item) => item.type === "trace")
        .map((item) => ({ id: item.id, created_at: item.timestamp, ...item.data })),
    };
  });

  // SSE endpoint for live event streaming
  app.get("/sessions/:session_id/events/stream", async (req, reply) => {
    const { session_id } = req.params as { session_id: string };

    // Verify session exists
    const session = await getProvider("session").get(session_id);
    if (!session) {
      reply.code(404).send({ error: "session not found" });
      return;
    }

    // Set SSE headers
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    // Send initial connected event
    reply.raw.write(`event: connected\ndata: ${JSON.stringify({ session_id })}\n\n`);

    // Poll for new events every 500ms (simple approach without pub/sub)
    let lastEventCount = 0;
    const pollInterval = setInterval(async () => {
      try {
        const timeline = await getProvider("session").getTimeline(session_id);
        const newItems = timeline.slice(lastEventCount);
        if (newItems.length > 0) {
          lastEventCount = timeline.length;
          for (const item of newItems) {
            reply.raw.write(
              `event: ${item.type}\ndata: ${JSON.stringify({ id: item.id, timestamp: item.timestamp, data: item.data })}\n\n`,
            );
          }
        }
      } catch {
        // Connection may have closed
      }
    }, 500);

    // Clean up on connection close
    req.raw.on("close", () => {
      clearInterval(pollInterval);
    });
  });
}

export async function traceRoutes(app: FastifyInstance): Promise<void> {
  app.post("/traces/tool-call", async (req, reply) => {
    const input = ToolCallTraceInput.parse(req.body);
    const trace = await getProvider("trace").recordToolCall(
      input.session_id,
      input.action_name,
      input.input,
      input.output,
      input.duration_ms,
    );
    reply.code(201);
    return { id: trace.id, trace_type: trace.trace_type, action_name: trace.action_name };
  });

  app.post("/traces/skill-run", async (req, reply) => {
    const input = SkillRunTraceInput.parse(req.body);
    const trace = await getProvider("trace").recordSkillRun(
      input.session_id,
      input.skill_name,
      input.input,
      input.output,
      input.duration_ms,
    );
    reply.code(201);
    return { id: trace.id, trace_type: trace.trace_type, skill_name: trace.action_name };
  });

  app.get("/traces/session/:session_id", async (req) => {
    const { session_id } = req.params as { session_id: string };
    const traces = await getProvider("trace").getBySession(session_id);
    return { session_id, traces };
  });
}

/**
 * Auto-extract memories from session events when a session is closed.
 * Combines all event data and trace outputs into a single text blob,
 * then runs LLM extraction and writes high-confidence candidates as memories.
 */
async function extractSessionMemories(sessionId: string): Promise<void> {
  const timeline = await getProvider("session").getTimeline(sessionId);
  if (timeline.length === 0) return;

  // Build a text summary from all events and traces
  const textParts: string[] = [];
  for (const item of timeline) {
    if (item.type === "event") {
      const eventData = item.data as Record<string, unknown>;
      textParts.push(`[${eventData.event_type ?? "event"}]: ${JSON.stringify(eventData)}`);
    } else if (item.type === "trace") {
      const traceData = item.data as Record<string, unknown>;
      textParts.push(`[trace:${traceData.trace_type ?? "unknown"}]: ${JSON.stringify(traceData)}`);
    }
  }
  const combinedText = textParts.join("\n");
  if (combinedText.length < 20) return;

  // Prefer DeepSeek when configured, fall back to Gemini
  const client = isDeepSeekConfigured() ? new DeepSeekClient() : new GeminiClient();
  const result = await llmJson(client, MemoryExtractionResult, [
    {
      role: "system",
      content: `You are a memory extraction system for a software development agent platform.
Given a session transcript, extract durable facts, conventions, patterns, and lessons worth remembering.

Return valid JSON matching this schema:
{
  "candidates": [
    {
      "content": "The extracted fact or convention",
      "confidence": 0.0-1.0 float indicating relevance/importance,
      "scope": optional, one of "user", "repo", "branch", "task", "session", "executor", "global_policy"
    }
  ]
}

Guidelines:
- Extract facts that would be useful in future sessions (conventions, patterns, gotchas, preferences)
- Confidence: 0.9+ for explicit rules, 0.6-0.8 for conventions, 0.3-0.5 for observations
- Return at most 10 candidates, sorted by confidence descending
- Skip trivial or ephemeral facts`,
    },
    { role: "user", content: combinedText },
  ]);

  if (!result.success) return;

  // Write high-confidence candidates as memories
  const memoryProvider = getProvider("memory");
  for (const candidate of result.data.candidates) {
    if (candidate.confidence >= 0.5) {
      await memoryProvider.write({
        scope: candidate.scope ?? "session",
        scope_id: sessionId,
        content: candidate.content,
        kind: "observation",
        metadata: { source: "auto-extract", session_id: sessionId, confidence: candidate.confidence },
      }).catch((err) => {
        console.error(`[auto-extract] failed to write memory:`, err);
      });
    }
  }
}
