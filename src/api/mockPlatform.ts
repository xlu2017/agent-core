/**
 * Mock platform endpoints.
 *
 * These simulate the future platform (jubilant-goggles) for local testing
 * and contract validation. They return realistic responses but perform no
 * real enforcement.
 *
 * SECURITY BOUNDARY: These are mock endpoints only. They must never:
 *   - Spend money
 *   - Deploy code
 *   - Access secrets
 *   - Modify files outside the worktree
 *   - Run commands
 *   - Push commits
 *   - Create PRs
 */

import { FastifyInstance } from "fastify";
import { v4 as uuid } from "uuid";

export async function mockPlatformRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /mock-platform/repos/open
   *
   * Simulates opening/cloning a repository.
   * In production, the platform would clone the repo and set up a worktree.
   */
  app.post("/mock-platform/repos/open", async (req) => {
    const body = req.body as Record<string, unknown> | undefined;
    const repoUrl = (body?.repo_url as string) ?? "https://github.com/org/repo";
    const branch = (body?.branch as string) ?? "main";

    const repoId = uuid();

    return {
      repo_id: repoId,
      repo_url: repoUrl,
      branch,
      status: "opened",
      note: "[mock] Repository opened. In production, this would clone the repo and set up a worktree.",
      advisory_only: true,
      requires_platform_validation: true,
    };
  });

  /**
   * POST /mock-platform/worktrees/create
   *
   * Simulates creating a worktree for a session.
   * In production, the platform would create a git worktree or checkout.
   */
  app.post("/mock-platform/worktrees/create", async (req) => {
    const body = req.body as Record<string, unknown> | undefined;
    const repoId = (body?.repo_id as string) ?? "repo-abc";
    const branch = (body?.branch as string) ?? "fix/login";

    const worktreeId = uuid();

    return {
      worktree_id: worktreeId,
      repo_id: repoId,
      branch,
      path: `/tmp/worktrees/${worktreeId}`,
      status: "created",
      note: "[mock] Worktree created. In production, this would create a git worktree.",
      advisory_only: true,
      requires_platform_validation: true,
    };
  });

  /**
   * POST /mock-platform/executors/select
   *
   * Simulates selecting an executor for a task.
   * In production, the platform would route to the appropriate executor
   * (code editor, shell, browser, etc.).
   */
  app.post("/mock-platform/executors/select", async (req) => {
    const body = req.body as Record<string, unknown> | undefined;
    const taskType = (body?.task_type as string) ?? "code_edit";
    const complexityScore = Number(body?.complexity_score ?? 50);

    // Map task types to executor types
    const executorMap: Record<string, string> = {
      code_edit: "code-executor",
      bug_fix: "code-executor",
      review: "code-executor",
      ask: "knowledge-executor",
      test: "test-executor",
      deploy: "deploy-executor",
    };

    const executorType = executorMap[taskType] ?? "general-executor";

    return {
      executor_id: uuid(),
      executor_type: executorType,
      task_type: taskType,
      complexity_score: complexityScore,
      status: "selected",
      note: "[mock] Executor selected. In production, this would route to the appropriate executor.",
      advisory_only: true,
      requires_platform_validation: true,
    };
  });

  /**
   * POST /mock-platform/commits/mock
   *
   * Simulates creating a commit.
   * In production, the platform would perform the actual git commit.
   * agent-core must never perform commits itself.
   */
  app.post("/mock-platform/commits/mock", async (req) => {
    const body = req.body as Record<string, unknown> | undefined;
    const sessionId = (body?.session_id as string) ?? uuid();
    const repoId = (body?.repo_id as string) ?? "demo";
    const message = (body?.message as string) ?? "chore: update";
    const files = (body?.files as string[]) ?? [];

    const commitHash = uuid().replace(/-/g, "").slice(0, 12);

    return {
      commit_hash: commitHash,
      session_id: sessionId,
      repo_id: repoId,
      message,
      files,
      author: "agent-core (mock)",
      status: "committed",
      note: "[mock] Commit created. In production, the platform would perform the actual git commit.",
      advisory_only: true,
      requires_platform_validation: true,
    };
  });
}
