
const crypto = require('crypto');
const { getRedisClient } = require('../config/redis');

/**
 * Two distinct cache layers live on top of this generic wrapper:
 *

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