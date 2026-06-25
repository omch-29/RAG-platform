const express = require('express');
const { authMiddleware, authMiddlewareSSE } = require('../middleware/auth');
const rateLimitMiddleware = require('../middleware/rateLimit');
const { queryDocuments, getUsage } = require('../controllers/query.controller');
const { queryStream } = require('../controllers/queryStream.controller');

const router = express.Router();

router.post('/', authMiddleware, rateLimitMiddleware, queryDocuments);
router.get('/stream', authMiddlewareSSE, rateLimitMiddleware, queryStream);
router.get('/usage', authMiddleware, getUsage);

module.exports = router;