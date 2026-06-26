const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Tenant = require('../models/Tenant');
const User = require('../models/User');

function signToken(user) {
  return jwt.sign(
    { tenantId: user.tenant.toString(), userId: user._id.toString(), role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

/**
 * Creates a new tenant (company) along with its first admin user.
 * In a real product this would be the "sign up your company" flow.
 */
async function signupTenant(req, res, next) {
  try {
    const { tenantName, slug, email, password } = req.body;

    if (!tenantName || !slug || !email || !password) {
      return res.status(400).json({ error: 'tenantName, slug, email, and password are required' });
    }

    const existingTenant = await Tenant.findOne({ slug });
    if (existingTenant) {
      return res.status(409).json({ error: 'Tenant slug already taken' });
    }

    const tenant = await Tenant.create({ name: tenantName, slug });

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({
      tenant: tenant._id,
      email,
      passwordHash,
      role: 'admin',
    });

    const token = signToken(user);

    res.status(201).json({
      token,
      tenant: { id: tenant._id, name: tenant.name, slug: tenant.slug },
      user: { id: user._id, email: user.email, role: user.role },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Logs in a user within their tenant. Login is scoped by tenant slug +
 * email, since email is only unique per-tenant, not globally.
 */
async function login(req, res, next) {
  try {
    const { slug, email, password } = req.body;

    if (!slug || !email || !password) {
      return res.status(400).json({ error: 'slug, email, and password are required' });
    }

    const tenant = await Tenant.findOne({ slug });
    if (!tenant) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = await User.findOne({ tenant: tenant._id, email });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = signToken(user);

    res.json({
      token,
      tenant: { id: tenant._id, name: tenant.name, slug: tenant.slug },
      user: { id: user._id, email: user.email, role: user.role },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { signupTenant, login, inviteMember };

/**
 * Lets an existing admin create an additional user under their OWN
 * tenant — this is how a teammate joins the same workspace, as opposed
 * to signupTenant which always creates a brand new, isolated tenant.
 * Without this endpoint there was no way for a second person to ever
 * join an existing company's workspace.
 */
async function inviteMember(req, res, next) {
  try {
    const { email, password, role } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }

    const existing = await User.findOne({ tenant: req.tenantId, email });
    if (existing) {
      return res.status(409).json({ error: 'A user with this email already exists in this workspace' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({
      tenant: req.tenantId,
      email,
      passwordHash,
      role: role === 'admin' ? 'admin' : 'member',
    });

    res.status(201).json({
      user: { id: user._id, email: user.email, role: user.role },
      message: 'Teammate added. They can now log in using your workspace slug, this email, and this password.',
    });
  } catch (err) {
    next(err);
  }
}