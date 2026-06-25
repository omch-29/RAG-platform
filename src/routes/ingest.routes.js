const express = require('express');
const { authMiddleware, requireAdmin } = require('../middleware/auth');
const rateLimitMiddleware = require('../middleware/rateLimit');
const { ingestDocument, listDocuments } = require('../controllers/ingest.controller');

const router = express.Router();

router.use(authMiddleware);

router.post('/', requireAdmin, rateLimitMiddleware, ingestDocument);
router.get('/', listDocuments);

module.exports = router;