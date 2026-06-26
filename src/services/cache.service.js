// const crypto = require('crypto');
// const { getRedisClient } = require('../config/redis');

// /**
//  * Two distinct cache layers live on top of this generic wrapper:
//  *
//  * 1. Embedding cache (services/embedding.service.js)
//  *    Key: hash of the exact text being embedded.
//  *    Why it's safe to cache forever (no TTL): the same text + the same
//  *    embedding model ALWAYS produces the same vector — this is a pure
//  *    function, not something that goes stale over time. Caching here
//  *    avoids re-running the CPU-bound embedding model on text we've
//  *    already embedded (e.g. re-ingesting an updated doc that shares
//  *    chunks with a previous version, or a user asking the same question
//  *    twice).
//  *
//  * 2. Query-result cache (controllers/query.controller.js)
//  *    Key: tenantId + hash of the question text.
//  *    Why this DOES need a TTL: the underlying documents for a tenant can
//  *    change (new docs ingested), so a cached answer can go stale. We
//  *    expire it instead of trying to track precise invalidation in Phase 2
//  *    -- a tenant-aware invalidation-on-ingest strategy is a reasonable
//  *    future improvement, not required for this phase.
//  *    The tenantId is deliberately part of the key, not just the question
//  *    text -- two different tenants asking the identical question must
//  *    never share a cached answer, or that's a tenant-isolation leak via
//  *    the cache layer.
//  */

// function hashKey(text) {
//   return crypto.createHash('sha256').update(text).digest('hex');
// }

// async function getCached(key) {
//   const redis = getRedisClient();
//   const value = await redis.get(key);
//   if (value === null) return null;
//   try {
//     return JSON.parse(value);
//   } catch {
//     return value;
//   }
// }

// async function setCached(key, value, ttlSeconds = null) {
//   const redis = getRedisClient();
//   const serialized = JSON.stringify(value);
//   if (ttlSeconds) {
//     await redis.set(key, serialized, 'EX', ttlSeconds);
//   } else {
//     await redis.set(key, serialized);
//   }
// }

// module.exports = { hashKey, getCached, setCached };

const crypto = require('crypto');
const { getRedisClient } = require('../config/redis');

/**
 * Two distinct cache layers live on top of this generic wrapper:
 *
 * 1. Embedding cache (services/embedding.service.js)
 *    Key: hash of the exact text being embedded.
 *    Why it's safe to cache forever (no TTL): the same text + the same
 *    embedding model ALWAYS produces the same vector — this is a pure
 *    function, not something that goes stale over time. Caching here
 *    avoids re-running the CPU-bound embedding model on text we've
 *    already embedded (e.g. re-ingesting an updated doc that shares
 *    chunks with a previous version, or a user asking the same question
 *    twice).
 *
 * 2. Query-result cache (controllers/query.controller.js)
 *    Key: tenantId + hash of the question text.
 *    Why this DOES need a TTL: the underlying documents for a tenant can
 *    change (new docs ingested), so a cached answer can go stale. We
 *    expire it instead of trying to track precise invalidation in Phase 2
 *    -- a tenant-aware invalidation-on-ingest strategy is a reasonable
 *    future improvement, not required for this phase.
 *    The tenantId is deliberately part of the key, not just the question
 *    text -- two different tenants asking the identical question must
 *    never share a cached answer, or that's a tenant-isolation leak via
 *    the cache layer.
 */

function hashKey(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

async function getCached(key) {
  const redis = getRedisClient();
  const value = await redis.get(key);
  if (value === null) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

async function setCached(key, value, ttlSeconds = null) {
  const redis = getRedisClient();
  const serialized = JSON.stringify(value);
  if (ttlSeconds) {
    await redis.set(key, serialized, 'EX', ttlSeconds);
  } else {
    await redis.set(key, serialized);
  }
}

/**
 * Cache versioning — solves the staleness problem where a question asked
 * BEFORE a document is ingested gets cached, then the same question asked
 * AFTER ingestion (within the TTL window) would otherwise still get the
 * old, wrong, pre-ingestion answer.
 *
 * Mechanism: every tenant has a version counter in Redis. Query cache
 * keys embed the CURRENT version at write+read time. Ingesting a new
 * document bumps the version — old cache entries still exist in Redis
 * but their keys no longer match what new queries look up, so they're
 * silently orphaned (and expire naturally via their own TTL). This is
 * O(1) on both ingest and query — no need to scan/delete every old key.
 */
async function getTenantCacheVersion(tenantId) {
  const redis = getRedisClient();
  const version = await redis.get(`cacheversion:${tenantId}`);
  return version ? parseInt(version, 10) : 0;
}

async function bumpTenantCacheVersion(tenantId) {
  const redis = getRedisClient();
  await redis.incr(`cacheversion:${tenantId}`);
}

module.exports = { hashKey, getCached, setCached, getTenantCacheVersion, bumpTenantCacheVersion };