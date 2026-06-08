/**
 * OpenVikingContextProvider — hierarchical context tree provider.
 *
 * Integration status: "reference"
 *
 * Design inspiration from OpenViking (volcengine/OpenViking):
 *   - VikingFS hierarchical tree with L0 (abstract/overview) and L1 (detail) levels
 *   - HierarchicalRetriever with multi-level convergence scoring
 *   - Directory dominance scoring for relevance ranking
 *   - Cross-repo relation management
 *
 * This implementation is original TypeScript code. No code was copied from
 * OpenViking (AGPL-3.0 licensed). The design patterns (hierarchical retrieval,
 * L0/L1 levels, convergence scoring) are used as reference only.
 *
 * Key features:
 *   - Hierarchical context tree with L0 (summary) and L1 (detail) content levels
 *   - Multi-level retrieval with convergence scoring across tree levels
 *   - Directory dominance scoring — parent nodes inherit relevance from children
 *   - Cross-repo context links with typed relations
 *   - SQLite-backed persistence
 */

import { v4 as uuidv4 } from "uuid";
import { getDb } from "../../db.js";
import type {
  ContextProvider,
  ContextNode,
  ContextSearchResult,
  ContextLink,
} from "../ContextProvider.js";
import type { ProviderStatus } from "../registry.js";

// ── Configuration Constants ──────────────────────────────────────────

/** Default tree structure for newly onboarded repos. */
const DEFAULT_TREE: ContextNode = {
  path: "repo",
  label: "repo",
  children: [
    "overview",
    "commands",
    "architecture",
    "dependencies",
    "tests",
    "entrypoints",
    "known-failures",
    "skills",
    "sessions",
    "policy-notes",
  ].map((path) => ({
    path: `repo/${path}`,
    label: path,
    content: "",
    children: [],
  })),
};

/**
 * Maximum number of convergence rounds for hierarchical retrieval.
 * Each round expands the search to parent/child levels and re-ranks.
 */
const MAX_CONVERGENCE_ROUNDS = 3;

/**
 * Directory dominance ratio — the weight given to a parent node's score
 * based on the aggregate scores of its children. Higher values mean
 * parent nodes are more likely to be returned when children match.
 */
const DIRECTORY_DOMINANCE_RATIO = 0.3;

/**
 * Score boost for L0 (summary/overview) content matches.
 * L0 content is considered more authoritative than L1 detail content.
 */
const L0_SCORE_BOOST = 1.2;

/**
 * Score boost for exact label matches vs. content matches.
 */
const LABEL_MATCH_SCORE = 0.8;

/**
 * Score for content-only matches (no label match).
 */
const CONTENT_MATCH_SCORE = 0.5;

// ── Database Row Types ───────────────────────────────────────────────

interface ContextRepoRow {
  repo_id: string;
  tree: string;
}

interface ContextLinkRow {
  id: string;
  source_repo: string;
  source_path: string;
  target_repo: string;
  target_path: string;
  relation: string;
}

// ── OpenVikingContextProvider ────────────────────────────────────────

export class OpenVikingContextProvider implements ContextProvider {
  readonly name = "openviking-context";
  readonly status: ProviderStatus = "reference";

  // ── Onboard ──────────────────────────────────────────────────────

  /**
   * Onboard a repository into the context tree.
   * Creates a default hierarchical tree if one doesn't exist.
   */
  async onboard(repo_id: string): Promise<ContextNode> {
    const db = getDb();
    const existing = db
      .prepare("SELECT * FROM context_repos WHERE repo_id = ?")
      .get(repo_id) as ContextRepoRow | undefined;

    if (existing) {
      return this.parseTree(existing.tree);
    }

    db.prepare(
      "INSERT INTO context_repos (repo_id, tree) VALUES (?, ?)",
    ).run(repo_id, JSON.stringify(DEFAULT_TREE));

    return structuredClone(DEFAULT_TREE);
  }

  // ── Get Tree ─────────────────────────────────────────────────────

  /**
   * Retrieve the full context tree for a repository.
   */
  async getTree(repo_id: string): Promise<ContextNode | null> {
    const row = getDb()
      .prepare("SELECT * FROM context_repos WHERE repo_id = ?")
      .get(repo_id) as ContextRepoRow | undefined;

    return row ? this.parseTree(row.tree) : null;
  }

  // ── Search (Hierarchical Retrieval) ──────────────────────────────

  /**
   * Search the context tree using hierarchical retrieval with convergence.
   *
   * Algorithm (inspired by OpenViking HierarchicalRetriever):
   *   1. Initial search — scan all nodes for label/content matches
   *   2. Convergence rounds — for each result, expand to parent/child
   *      levels and re-rank using directory dominance scoring
   *   3. L0 boost — nodes at L0 (summary) level get a score multiplier
   *   4. Deduplication and final ranking
   */
  async search(
    query: string,
    repo_id?: string,
  ): Promise<ContextSearchResult[]> {
    const db = getDb();
    const rows = repo_id
      ? (db
          .prepare("SELECT * FROM context_repos WHERE repo_id = ?")
          .all(repo_id) as ContextRepoRow[])
      : (db.prepare("SELECT * FROM context_repos").all() as ContextRepoRow[]);

    const normalizedQuery = query.toLowerCase();
    const queryTerms = normalizedQuery.split(/\s+/).filter(Boolean);

    if (queryTerms.length === 0) return [];

    const allResults: ContextSearchResult[] = [];

    for (const row of rows) {
      const tree = this.parseTree(row.tree);
      const repoResults = this.hierarchicalSearch(
        tree,
        normalizedQuery,
        queryTerms,
      );
      allResults.push(...repoResults);
    }

    // Sort by score descending, then by path alphabetically
    allResults.sort((a, b) => {
      const scoreDiff = b.score - a.score;
      if (scoreDiff !== 0) return scoreDiff;
      return a.path.localeCompare(b.path);
    });

    return allResults;
  }

  // ── Link ─────────────────────────────────────────────────────────

  /**
   * Create a typed relation between two context nodes across repos.
   */
  async link(
    source_repo: string,
    source_path: string,
    target_repo: string,
    target_path: string,
    relation = "related",
  ): Promise<ContextLink> {
    const id = uuidv4();
    const db = getDb();

    db.prepare(
      `INSERT INTO context_links (id, source_repo, source_path, target_repo, target_path, relation)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(id, source_repo, source_path, target_repo, target_path, relation);

    const row = db
      .prepare("SELECT * FROM context_links WHERE id = ?")
      .get(id) as ContextLinkRow | undefined;

    if (!row) {
      throw new Error(`Failed to create context link "${id}"`);
    }

    return row;
  }

  // ── Promote ──────────────────────────────────────────────────────

  /**
   * Promote content to a specific path in the context tree.
   * Creates intermediate nodes if the path doesn't exist.
   */
  async promote(
    repo_id: string,
    path: string,
    content: string,
  ): Promise<ContextNode | null> {
    const tree = await this.getTree(repo_id);
    if (!tree) return null;

    const promoted = this.setNodeContent(tree, path, content);
    getDb()
      .prepare("UPDATE context_repos SET tree = ? WHERE repo_id = ?")
      .run(JSON.stringify(tree), repo_id);

    return promoted;
  }

  // ── Private: Hierarchical Search ─────────────────────────────────

  /**
   * Perform hierarchical retrieval with convergence scoring.
   *
   * This implements a multi-level search inspired by OpenViking's
   * HierarchicalRetriever:
   *
   * Round 0 (Initial): Scan all nodes for direct matches.
   * Round 1 (Converge Up): For matching leaf nodes, score their parents
   *   using directory dominance (children's scores contribute to parent).
   * Round 2 (Converge Down): For matching parent nodes, boost children
   *   that are on the matching path.
   * Round 3 (Final): Apply L0 boost and deduplicate.
   */
  private hierarchicalSearch(
    tree: ContextNode,
    normalizedQuery: string,
    queryTerms: string[],
  ): ContextSearchResult[] {
    // Round 0: Initial flat scan
    const initialResults: ContextSearchResult[] = [];
    this.collectMatches(tree, normalizedQuery, queryTerms, initialResults);

    if (initialResults.length === 0) return [];

    // Build a path-to-node map for convergence
    const nodeMap = new Map<string, ContextNode>();
    this.buildNodeMap(tree, nodeMap);

    // Round 1: Converge Up — score parents based on children
    const parentBoostMap = new Map<string, number>();
    for (const result of initialResults) {
      const parentPath = this.getParentPath(result.path);
      if (parentPath) {
        const current = parentBoostMap.get(parentPath) ?? 0;
        parentBoostMap.set(
          parentPath,
          current + result.score * DIRECTORY_DOMINANCE_RATIO,
        );
      }
    }

    // Round 2: Converge Down — boost children of matching parents
    const childBoostMap = new Map<string, number>();
    for (const result of initialResults) {
      const node = nodeMap.get(result.path);
      if (node?.children && node.children.length > 0) {
        for (const child of node.children) {
          const current = childBoostMap.get(child.path) ?? 0;
          childBoostMap.set(child.path, current + result.score * 0.15);
        }
      }
    }

    // Round 3: Build final results with convergence scores
    const seen = new Set<string>();
    const finalResults: ContextSearchResult[] = [];

    // Add initial results with convergence boosts
    for (const result of initialResults) {
      const parentBoost = parentBoostMap.get(result.path) ?? 0;
      const childBoost = childBoostMap.get(result.path) ?? 0;
      const isL0 = this.isL0Node(result.path);
      const l0Boost = isL0 ? L0_SCORE_BOOST : 1.0;

      const convergedScore = Math.min(
        (result.score + parentBoost + childBoost) * l0Boost,
        1.0,
      );

      if (!seen.has(result.path)) {
        seen.add(result.path);
        finalResults.push({
          ...result,
          score: convergedScore,
        });
      }
    }

    // Add parent nodes that got boosted but weren't in initial results
    for (const [parentPath, boost] of parentBoostMap) {
      if (!seen.has(parentPath) && boost > 0.1) {
        const parentNode = nodeMap.get(parentPath);
        if (parentNode) {
          seen.add(parentPath);
          const isL0 = this.isL0Node(parentPath);
          const l0Boost = isL0 ? L0_SCORE_BOOST : 1.0;
          finalResults.push({
            path: parentPath,
            label: parentNode.label,
            score: Math.min(boost * l0Boost, 1.0),
            content: parentNode.content
              ? `[converged from children: ${parentNode.content}]`
              : `[directory: ${parentNode.label}]`,
          });
        }
      }
    }

    return finalResults;
  }

  // ── Private: Match Collection ────────────────────────────────────

  /**
   * Recursively collect matching nodes from the tree.
   * Uses term-level matching for more granular scoring.
   */
  private collectMatches(
    node: ContextNode,
    normalizedQuery: string,
    queryTerms: string[],
    results: ContextSearchResult[],
  ): void {
    const content = node.content ?? "";
    const labelLower = node.label.toLowerCase();
    const contentLower = content.toLowerCase();

    // Count how many query terms match in label and content
    let labelTermMatches = 0;
    let contentTermMatches = 0;

    for (const term of queryTerms) {
      if (labelLower.includes(term)) {
        labelTermMatches++;
      }
      if (contentLower.includes(term)) {
        contentTermMatches++;
      }
    }

    const hasLabelMatch = labelLower.includes(normalizedQuery);
    const hasContentMatch =
      contentLower.includes(normalizedQuery) && content.length > 0;

    if (hasLabelMatch || hasContentMatch || labelTermMatches > 0) {
      // Compute a more nuanced score based on term frequency
      const labelRatio =
        queryTerms.length > 0 ? labelTermMatches / queryTerms.length : 0;
      const contentRatio =
        queryTerms.length > 0 ? contentTermMatches / queryTerms.length : 0;

      let score: number;
      if (hasLabelMatch) {
        score = LABEL_MATCH_SCORE + contentRatio * 0.2;
      } else if (hasContentMatch) {
        score = CONTENT_MATCH_SCORE + contentRatio * 0.3;
      } else if (labelRatio > 0) {
        score = labelRatio * 0.5;
      } else {
        score = contentRatio * 0.3;
      }

      results.push({
        path: node.path,
        label: node.label,
        score: Math.min(score, 1.0),
        content: hasContentMatch
          ? content
          : `[node: ${node.label}]`,
      });
    }

    // Recurse into children
    for (const child of node.children ?? []) {
      this.collectMatches(child, normalizedQuery, queryTerms, results);
    }
  }

  // ── Private: Tree Utilities ──────────────────────────────────────

  /**
   * Build a flat path-to-node map for efficient convergence lookups.
   */
  private buildNodeMap(
    node: ContextNode,
    map: Map<string, ContextNode>,
  ): void {
    map.set(node.path, node);
    for (const child of node.children ?? []) {
      this.buildNodeMap(child, map);
    }
  }

  /**
   * Get the parent path from a given path.
   * e.g., "repo/architecture/patterns" → "repo/architecture"
   */
  private getParentPath(path: string): string | null {
    const lastSlash = path.lastIndexOf("/");
    if (lastSlash <= 0) return null;
    return path.substring(0, lastSlash);
  }

  /**
   * Determine if a path represents an L0 (summary-level) node.
   * L0 nodes are top-level sections like "repo/overview", "repo/architecture".
   */
  private isL0Node(path: string): boolean {
    // L0 nodes are direct children of "repo" (depth 2)
    const segments = path.split("/");
    return segments.length === 2 && segments[0] === "repo";
  }

  /**
   * Parse a JSON string into a ContextNode tree.
   */
  private parseTree(value: string): ContextNode {
    return JSON.parse(value) as ContextNode;
  }

  /**
   * Set content on a node identified by path, creating intermediate
   * nodes as needed.
   */
  private setNodeContent(
    node: ContextNode,
    path: string,
    content: string,
  ): ContextNode {
    if (node.path === path) {
      node.content = content;
      return node;
    }

    const children = node.children ?? [];
    const existing = children.find(
      (child) => path === child.path || path.startsWith(`${child.path}/`),
    );

    if (existing) {
      return this.setNodeContent(existing, path, content);
    }

    // Create a new node
    const child: ContextNode = {
      path,
      label: path.split("/").at(-1) ?? path,
      content,
      children: [],
    };
    node.children = [...children, child];
    return child;
  }
}
