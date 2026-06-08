/**
 * API key authentication middleware.
 *
 * Reference: Parlant — AuthorizationPolicy + ProductionAuthorizationPolicy
 *   vendor/providers/policy/parlant/src/parlant/api/authorization.py:154-270
 *   Parlant separates permission checks (check_permission) from rate limiting
 *   (check_rate_limit) via an abstract AuthorizationPolicy.
 *
 * Reference: cognee — FastAPI Depends(get_authenticated_user) + API key CRUD
 *   vendor/providers/knowledge/cognee/cognee/api/v1/api_keys/routers/get_api_key_management_router.py
 *   Cognee stores API keys per-user and authenticates via dependency injection.
 *
 * Our approach:
 *   - Fastify onRequest hook checks the `x-api-key` or `Authorization: Bearer`
 *     header against AGENT_CORE_API_KEY env var (single-tenant mode) OR
 *     against the tenant API key store (multi-tenant mode).
 *   - When no keys are configured, auth is disabled (development mode),
 *     matching Parlant's DevelopmentAuthorizationPolicy pattern.
 *   - Health and docs endpoints are always public, matching Parlant's exempt
 *     operation list.
 *   - Returns structured JSON error body with `code` field, unlike Parlant
 *     which raises Python exceptions caught by middleware.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { lookupTenant, hasTenantKeys } from "./apiKeyStore.js";

const PUBLIC_PREFIXES = ["/health", "/docs", "/docs/"];

function isPublicRoute(url: string): boolean {
  return PUBLIC_PREFIXES.some((prefix) => url === prefix || url.startsWith(prefix));
}

export async function registerAuth(app: FastifyInstance): Promise<void> {
  const masterApiKey = process.env.AGENT_CORE_API_KEY;
  const tenantKeysConfigured = hasTenantKeys();

  if (!masterApiKey && !tenantKeysConfigured) {
    // Development mode — no auth enforcement, like Parlant's
    // DevelopmentAuthorizationPolicy (authorization.py:176-202).
    return;
  }

  app.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
    if (isPublicRoute(request.url)) return;

    const provided =
      (request.headers["x-api-key"] as string) ??
      extractBearerToken(request.headers.authorization as string | undefined);

    if (!provided) {
      reply.code(401).send({
        error: "Unauthorized",
        code: "AUTH_MISSING_KEY",
        message: "Missing API key. Provide via x-api-key header or Authorization: Bearer.",
      });
      return;
    }

    // Check master API key first (admin access)
    if (masterApiKey && provided === masterApiKey) {
      // Attach admin context to request
      (request as Record<string, unknown>).tenantContext = {
        tenant_id: "__admin__",
        tenant_name: "admin",
        role: "admin",
        key_id: "__master__",
      };
      return;
    }

    // Check tenant API key store
    if (tenantKeysConfigured) {
      const tenant = lookupTenant(provided);
      if (tenant) {
        // Attach tenant context to request
        (request as Record<string, unknown>).tenantContext = tenant;
        return;
      }
    }

    reply.code(401).send({
      error: "Unauthorized",
      code: "AUTH_INVALID_KEY",
      message: "Invalid API key.",
    });
  });
}

function extractBearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const parts = header.split(" ");
  if (parts.length === 2 && parts[0].toLowerCase() === "bearer") {
    return parts[1];
  }
  return null;
}
