const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    tenant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: {
      type: String,
      required: true,
    },
    role: {
      type: String,
      enum: ['admin', 'member'], // admin can ingest docs, member can only query
      default: 'member',
    },
  },
  { timestamps: true }
);

// a given email only needs to be unique within a tenant, not globally —
// two different companies can both have a user "admin@theircompany.com"
userSchema.index({ tenant: 1, email: 1 }, { unique: true });

module.exports = mongoose.model('User', userSchema);