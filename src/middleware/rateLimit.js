const { checkRateLimit } = require('../services/rateLimit.service');

async function rateLimitMiddleware(req, res, next) {
  try {
    const { allowed, remaining, retryAfterSeconds, limit } = await checkRateLimit(req.tenantId);

    // standard-ish rate limit headers — lets a well-behaved client see
    // its budget without having to hit the limit first
    res.set({
      'X-RateLimit-Limit': limit,
      'X-RateLimit-Remaining': remaining,
    });

    if (!allowed) {
      res.set('Retry-After', retryAfterSeconds);
      return res.status(429).json({
        error: 'Rate limit exceeded. Try again shortly.',
        retryAfterSeconds,
      });
    }

    next();
  } catch (err) {
    next(err);
  }
}

module.exports = rateLimitMiddleware;