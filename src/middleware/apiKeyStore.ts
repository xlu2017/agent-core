/**
 * API Key Store — SQLite-backed per-tenant API key management.
 *
 * Provides the foundation for multi-tenant isolation:
 *   - Each tenant (user/org) has one or more API keys
 *   - Keys are stored as SHA-256 hashes (never plaintext)
 *   - Auth middleware can look up tenant context from a key
 *   - Rate limiting can be applied per tenant
 *
 * When no tenant keys are configured, falls back to the single
 * AGENT_CORE_API_KEY env var (backward compatible).
 */

import { getDb } from "../db.js";
import { createHash, randomBytes } from "node:crypto";

export interface TenantKey {
  id: string;
  tenant_id: string;
  tenant_name: string;
  key_prefix: string; // First 8 chars of the raw key for identification
  key_hash: string;   // SHA-256 hash of the full key
  role: string;       // "admin" | "read" | "write"
  enabled: boolean;
  created_at: string;
  last_used_at: string | null;
}

export interface TenantContext {
  tenant_id: string;
  tenant_name: string;
  role: string;
  key_id: string;
}

function ensureApiKeyTable(): void {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS tenant_api_keys (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      tenant_name TEXT NOT NULL DEFAULT '',
      key_prefix TEXT NOT NULL,
      key_hash TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL DEFAULT 'write',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_used_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_tenant_api_keys_hash ON tenant_api_keys(key_hash);
    CREATE INDEX IF NOT EXISTS idx_tenant_api_keys_tenant ON tenant_api_keys(tenant_id);
  `);
}

/**
 * Generate a new API key for a tenant.
 * Returns the raw key (shown once) and the stored record.
 */
export function generateApiKey(tenantId: string, tenantName: string, role: string = "write"): {
  raw_key: string;
  key: TenantKey;
} {
  ensureApiKeyTable();

  const rawKey = `ac_${randomBytes(24).toString("hex")}`;
  const keyHash = hashKey(rawKey);
  const keyPrefix = rawKey.slice(0, 8);
  const id = `key_${randomBytes(8).toString("hex")}`;
  const now = new Date().toISOString();

  getDb().prepare(`
    INSERT INTO tenant_api_keys (id, tenant_id, tenant_name, key_prefix, key_hash, role, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, tenantId, tenantName, keyPrefix, keyHash, role, now);

  return {
    raw_key: rawKey,
    key: {
      id,
      tenant_id: tenantId,
      tenant_name: tenantName,
      key_prefix: keyPrefix,
      key_hash: keyHash,
      role,
      enabled: true,
      created_at: now,
      last_used_at: null,
    },
  };
}

/**
 * Look up a tenant by API key.
 * Returns null if the key is invalid, disabled, or not found.
 */
export function lookupTenant(rawKey: string): TenantContext | null {
  ensureApiKeyTable();

  const keyHash = hashKey(rawKey);
  const row = getDb().prepare(`
    SELECT id, tenant_id, tenant_name, role FROM tenant_api_keys
    WHERE key_hash = ? AND enabled = 1
  `).get(keyHash) as { id: string; tenant_id: string; tenant_name: string; role: string } | undefined;

  if (!row) return null;

  // Update last_used_at
  getDb().prepare("UPDATE tenant_api_keys SET last_used_at = datetime('now') WHERE id = ?").run(row.id);

  return {
    tenant_id: row.tenant_id,
    tenant_name: row.tenant_name,
    role: row.role,
    key_id: row.id,
  };
}

/**
 * List all API keys for a tenant.
 */
export function listTenantKeys(tenantId: string): TenantKey[] {
  ensureApiKeyTable();
  return getDb().prepare(`
    SELECT * FROM tenant_api_keys WHERE tenant_id = ? ORDER BY created_at DESC
  `).all(tenantId) as TenantKey[];
}

/**
 * Revoke (disable) an API key.
 */
export function revokeApiKey(keyId: string): boolean {
  ensureApiKeyTable();
  const result = getDb().prepare("UPDATE tenant_api_keys SET enabled = 0 WHERE id = ?").run(keyId);
  return result.changes > 0;
}

/**
 * Delete an API key permanently.
 */
export function deleteApiKey(keyId: string): boolean {
  ensureApiKeyTable();
  const result = getDb().prepare("DELETE FROM tenant_api_keys WHERE id = ?").run(keyId);
  return result.changes > 0;
}

/**
 * Check if the tenant API key store has any keys configured.
 */
export function hasTenantKeys(): boolean {
  ensureApiKeyTable();
  const row = getDb().prepare("SELECT COUNT(*) as cnt FROM tenant_api_keys").get() as { cnt: number };
  return row.cnt > 0;
}

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}
