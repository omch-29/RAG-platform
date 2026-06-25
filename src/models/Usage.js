const mongoose = require('mongoose');

/**
 * One document per (tenant, day) — counts get incremented atomically via
 * $inc on every Groq call, rather than writing one row per request.
 * Aggregating at write-time (instead of summing many rows at read-time)
 * keeps the /api/usage endpoint a cheap single lookup even after months
 * of usage, which is the right trade-off for a dashboard that gets read
 * far more often than the underlying data changes shape.
 */
const usageSchema = new mongoose.Schema(
  {
    tenant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
    },
    date: {
      type: String, // YYYY-MM-DD, used as a simple daily bucket key
      required: true,
    },
    requestCount: { type: Number, default: 0 },
    promptTokens: { type: Number, default: 0 },
    completionTokens: { type: Number, default: 0 },
    totalTokens: { type: Number, default: 0 },
    estimatedCostUSD: { type: Number, default: 0 },
  },
  { timestamps: true }
);

usageSchema.index({ tenant: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('Usage', usageSchema);