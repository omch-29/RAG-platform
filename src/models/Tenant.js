const mongoose = require('mongoose');

const tenantSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      // used as the metadata key for filtering chunks in the vector store
      // e.g. "stripe-docs", "acme-corp"
    },
    plan: {
      type: String,
      enum: ['free', 'pro'],
      default: 'free',
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Tenant', tenantSchema);