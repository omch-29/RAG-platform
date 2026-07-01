const { getRedisClient } = require('../config/redis');

/**
 * Fixed-window rate limiting: count requests in the current 60-second
 *
 */

const LIMIT_PER_MINUTE = parseInt(process.env.RATE_LIMIT_PER_MINUTE, 10) || 20;

function currentWindowKey(tenantId) {
  const minuteBucket = Math.floor(Date.now() / 60000); // changes every 60 seconds
  return `ratelimit:${tenantId}:${minuteBucket}`;
}

/**
 * Returns { allowed, remaining, retryAfterSeconds }.
 */
async function checkRateLimit(tenantId) {
  const redis = getRedisClient();
  const key = currentWindowKey(tenantId);

  const count = await redis.incr(key);

  if (count === 1) {
    // first request in this window — set the key to expire in 60s so it
    // doesn't accumulate forever; only needs to be set once per window
    await redis.expire(key, 60);
  }

  const allowed = count <= LIMIT_PER_MINUTE;
  const remaining = Math.max(0, LIMIT_PER_MINUTE - count);

  // seconds until the current minute bucket rolls over
  const retryAfterSeconds = 60 - Math.floor((Date.now() % 60000) / 1000);

  return { allowed, remaining, retryAfterSeconds, limit: LIMIT_PER_MINUTE };
}

module.exports = { checkRateLimit };