const jwt = require('jsonwebtoken');

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header' });
  }

  const token = header.split(' ')[1];

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    // every downstream query/ingest operation reads tenantId from here —
    // it is never trusted from the request body. This is the actual
    // tenant-isolation enforcement point.
    req.tenantId = payload.tenantId;
    req.userId = payload.userId;
    req.role = payload.role;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function authMiddlewareSSE(req, res, next) {
  const token = req.query.token;
 
  if (!token) {
    return res.status(401).json({ error: 'Missing token query parameter' });
  }
 
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.tenantId = payload.tenantId;
    req.userId = payload.userId;
    req.role = payload.role;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}


function requireAdmin(req, res, next) {
  if (req.role !== 'admin') {
    return res.status(403).json({ error: 'Admin role required for this action' });
  }
  next();
}

module.exports = { authMiddleware, authMiddlewareSSE, requireAdmin };