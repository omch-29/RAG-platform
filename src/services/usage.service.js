const Usage = require('../models/Usage');

/**
 * Cost is an ESTIMATE based on configurable per-1K-token prices, not a
 * real billing figure pulled from Groq's API — Groq doesn't return cost
 * directly, only token counts. Prices live in env vars specifically so
 * they can be corrected without a code change when actual pricing is
 * confirmed; treat the dollar figure as directional, not invoiced truth.
 */
const PROMPT_PRICE_PER_1K = parseFloat(process.env.COST_PER_1K_PROMPT_TOKENS) || 0.05;
const COMPLETION_PRICE_PER_1K = parseFloat(process.env.COST_PER_1K_COMPLETION_TOKENS) || 0.08;

function estimateCostUSD({ promptTokens = 0, completionTokens = 0 }) {
  return (promptTokens / 1000) * PROMPT_PRICE_PER_1K + (completionTokens / 1000) * COMPLETION_PRICE_PER_1K;
}

function todayKey() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

/**
 * Atomically increments today's usage bucket for a tenant. Called once
 * per real Groq generation call — deliberately NOT called on a cache
 * hit, since a cached response consumed zero actual LLM tokens. This is
 * the same caching benefit framed in cost terms instead of latency terms.
 */
async function recordUsage({ tenantId, usage }) {
  if (!usage) return; // no usage object (e.g. defensive guard) — nothing to record

  const promptTokens = usage.prompt_tokens || 0;
  const completionTokens = usage.completion_tokens || 0;
  const totalTokens = usage.total_tokens || promptTokens + completionTokens;
  const cost = estimateCostUSD({ promptTokens, completionTokens });

  await Usage.findOneAndUpdate(
    { tenant: tenantId, date: todayKey() },
    {
      $inc: {
        requestCount: 1,
        promptTokens,
        completionTokens,
        totalTokens,
        estimatedCostUSD: cost,
      },
    },
    { upsert: true, new: true }
  );
}

/**
 * Returns the tenant's usage history (one row per day) plus a summed
 * total across all days — what the /api/usage endpoint serves.
 */
async function getTenantUsage(tenantId) {
  const days = await Usage.find({ tenant: tenantId }).sort({ date: -1 }).lean();

  const totals = days.reduce(
    (acc, day) => ({
      requestCount: acc.requestCount + day.requestCount,
      promptTokens: acc.promptTokens + day.promptTokens,
      completionTokens: acc.completionTokens + day.completionTokens,
      totalTokens: acc.totalTokens + day.totalTokens,
      estimatedCostUSD: acc.estimatedCostUSD + day.estimatedCostUSD,
    }),
    { requestCount: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCostUSD: 0 }
  );

  return { days, totals };
}

module.exports = { recordUsage, getTenantUsage, estimateCostUSD };