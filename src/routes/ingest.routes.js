const express = require('express');
const multer = require('multer');
const { authMiddleware, requireAdmin } = require('../middleware/auth');
const rateLimitMiddleware = require('../middleware/rateLimit');
//const { ingestDocument, listDocuments } = require('../controllers/ingest.controller');
const { ingestDocument, ingestPdf, ingestUrl, listDocuments, deleteDocument } = require('../controllers/ingest.controller');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== 'application/pdf') return cb(new Error('Only PDF files are accepted'));
    cb(null, true);
  },
});

router.use(authMiddleware);

router.post('/', requireAdmin, rateLimitMiddleware, ingestDocument);
//router.post('/pdf', requireAdmin, rateLimitMiddleware, upload.single('pdf'), ingestPdf);
//router.post('/url', requireAdmin, rateLimitMiddleware, ingestUrl);
router.get('/', listDocuments);
router.delete('/:id', requireAdmin, deleteDocument);

module.exports = router;