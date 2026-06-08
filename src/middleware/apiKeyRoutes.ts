/**
 * API Key management routes.
 *
 * Provides CRUD for tenant-scoped API keys, enabling multi-tenant isolation.
 * These routes are protected by the master AGENT_CORE_API_KEY (admin access).
 */

import { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  generateApiKey,
  lookupTenant,
  listTenantKeys,
  revokeApiKey,
  deleteApiKey,
  hasTenantKeys,
} from "./apiKeyStore.js";

const CreateKeyInput = z.object({
  tenant_id: z.string().min(1),
  tenant_name: z.string().default(""),
  role: z.enum(["admin", "write", "read"]).default("write"),
});

const RevokeKeyInput = z.object({
  key_id: z.string().min(1),
});

export async function apiKeyRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /admin/api-keys — Create a new API key for a tenant.
   * Returns the raw key once (store it securely).
   */
  app.post("/admin/api-keys", async (req, reply) => {
    const input = CreateKeyInput.parse(req.body);
    const result = generateApiKey(input.tenant_id, input.tenant_name, input.role);
    reply.code(201);
    return {
      key_id: result.key.id,
      tenant_id: result.key.tenant_id,
      tenant_name: result.key.tenant_name,
      role: result.key.role,
      key_prefix: result.key.key_prefix,
      raw_key: result.raw_key,
      warning: "Store this key securely — it will not be shown again.",
    };
  });

  /**
   * GET /admin/api-keys/:tenant_id — List all keys for a tenant.
   */
  app.get("/admin/api-keys/:tenant_id", async (req) => {
    const { tenant_id } = req.params as { tenant_id: string };
    const keys = listTenantKeys(tenant_id);
    // Never expose key hashes
    return {
      tenant_id,
      keys: keys.map((k) => ({
        id: k.id,
        tenant_id: k.tenant_id,
        tenant_name: k.tenant_name,
        key_prefix: k.key_prefix,
        role: k.role,
        enabled: k.enabled,
        created_at: k.created_at,
        last_used_at: k.last_used_at,
      })),
    };
  });

  /**
   * POST /admin/api-keys/revoke — Revoke (disable) an API key.
   */
  app.post("/admin/api-keys/revoke", async (req) => {
    const input = RevokeKeyInput.parse(req.body);
    const revoked = revokeApiKey(input.key_id);
    if (!revoked) return { error: "key not found" };
    return { key_id: input.key_id, status: "revoked" };
  });

  /**
   * DELETE /admin/api-keys/:key_id — Permanently delete an API key.
   */
  app.delete("/admin/api-keys/:key_id", async (req, reply) => {
    const { key_id } = req.params as { key_id: string };
    const deleted = deleteApiKey(key_id);
    if (!deleted) return { error: "key not found" };
    reply.code(204);
    return;
  });

  /**
   * GET /admin/api-keys/status — Check if tenant key store is active.
   */
  app.get("/admin/api-keys/status", async () => {
    return {
      tenant_keys_configured: hasTenantKeys(),
      mode: hasTenantKeys() ? "multi-tenant" : "single-key",
    };
  });
}
