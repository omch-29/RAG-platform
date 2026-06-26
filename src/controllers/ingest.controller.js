

const Document = require('../models/Document');
const { chunkText } = require('../services/chunking.service');
const { embed } = require('../services/embedding.service');
const { addChunks } = require('../services/vectorStore.service');
const { indexChunks } = require('../services/keywordSearch.service');
const { bumpTenantCacheVersion } = require('../services/cache.service');

/**
 
 * Admin-only (enforced by requireAdmin middleware on the route) 
 */
async function ingestDocument(req, res, next) {
  let doc;
  try {
    const { title, text } = req.body;

    if (!title || !text) {
      return res.status(400).json({ error: 'title and text are required' });
    }

    doc = await Document.create({
      tenant: req.tenantId,
      title,
      sourceType: 'text',
      rawTextLength: text.length,
      status: 'processing',
    });

    const chunkSize = parseInt(process.env.CHUNK_SIZE, 10) || 500;
    const overlap = parseInt(process.env.CHUNK_OVERLAP, 10) || 50;
    const chunks = chunkText(text, { chunkSize, overlap });

    if (chunks.length === 0) {
      doc.status = 'failed';
      doc.error = 'No chunks produced from input text';
      await doc.save();
      return res.status(400).json({ error: 'No chunks produced from input text' });
    }

    const embeddings = await embed(chunks); // batched: array in, array of vectors out

    await addChunks({
      tenantId: req.tenantId,
      documentId: doc._id.toString(),
      chunkTexts: chunks,
      embeddings,
    });

    await indexChunks({
      tenantId: req.tenantId,
      documentId: doc._id.toString(),
      chunkTexts: chunks,
    });

    doc.chunkCount = chunks.length;
    doc.status = 'ready';
    await doc.save();

    // invalidate every previously cached answer for this tenant — a
    // question asked before this ingest may have a now-outdated cached
    // answer, and bumping the version makes that old cache entry
    // unreachable for all future lookups
    await bumpTenantCacheVersion(req.tenantId);

    res.status(201).json({
      documentId: doc._id,
      title: doc.title,
      chunkCount: doc.chunkCount,
      status: doc.status,
    });
  } catch (err) {
    if (doc) {
      doc.status = 'failed';
      doc.error = err.message;
      await doc.save().catch(() => {}); // don't let a logging failure mask the original error
    }
    next(err);
  }
}

async function listDocuments(req, res, next) {
  try {
    const docs = await Document.find({ tenant: req.tenantId })
      .select('title status chunkCount createdAt')
      .sort({ createdAt: -1 });
    res.json({ documents: docs });
  } catch (err) {
    next(err);
  }
}

module.exports = { ingestDocument, listDocuments };