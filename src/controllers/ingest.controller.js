

// const Document = require('../models/Document');
// const { chunkText } = require('../services/chunking.service');
// const { embed } = require('../services/embedding.service');
// const { addChunks } = require('../services/vectorStore.service');
// const { indexChunks } = require('../services/keywordSearch.service');
// const { bumpTenantCacheVersion } = require('../services/cache.service');

// /**
 
//  * Admin-only (enforced by requireAdmin middleware on the route) 
//  */
// async function ingestDocument(req, res, next) {
//   let doc;
//   try {
//     const { title, text } = req.body;

//     if (!title || !text) {
//       return res.status(400).json({ error: 'title and text are required' });
//     }

//     doc = await Document.create({
//       tenant: req.tenantId,
//       title,
//       sourceType: 'text',
//       rawTextLength: text.length,
//       status: 'processing',
//     });

//     const chunkSize = parseInt(process.env.CHUNK_SIZE, 10) || 500;
//     const overlap = parseInt(process.env.CHUNK_OVERLAP, 10) || 50;
//     const chunks = chunkText(text, { chunkSize, overlap });

//     if (chunks.length === 0) {
//       doc.status = 'failed';
//       doc.error = 'No chunks produced from input text';
//       await doc.save();
//       return res.status(400).json({ error: 'No chunks produced from input text' });
//     }

//     const embeddings = await embed(chunks); 

//     await addChunks({
//       tenantId: req.tenantId,
//       documentId: doc._id.toString(),
//       chunkTexts: chunks,
//       embeddings,
//     });

//     await indexChunks({
//       tenantId: req.tenantId,
//       documentId: doc._id.toString(),
//       chunkTexts: chunks,
//     });

//     doc.chunkCount = chunks.length;
//     doc.status = 'ready';
//     await doc.save();

//     // invalidate every previously cached answer for this tenant — a
//     // question asked before this ingest may have a now-outdated cached
//     // answer, and bumping the version makes that old cache entry
//     // unreachable for all future lookups
//     await bumpTenantCacheVersion(req.tenantId);

//     res.status(201).json({
//       documentId: doc._id,
//       title: doc.title,
//       chunkCount: doc.chunkCount,
//       status: doc.status,
//     });
//   } catch (err) {
//     if (doc) {
//       doc.status = 'failed';
//       doc.error = err.message;
//       await doc.save().catch(() => {}); // don't let a logging failure mask the original error
//     }
//     next(err);
//   }
// }

// async function listDocuments(req, res, next) {
//   try {
//     const docs = await Document.find({ tenant: req.tenantId })
//       .select('title status chunkCount createdAt')
//       .sort({ createdAt: -1 });
//     res.json({ documents: docs });
//   } catch (err) {
//     next(err);
//   }
// }

// module.exports = { ingestDocument, listDocuments };

const Document = require('../models/Document');
const { chunkText } = require('../services/chunking.service');
const { embed } = require('../services/embedding.service');
const { addChunks, getCollection } = require('../services/vectorStore.service');
const { indexChunks } = require('../services/keywordSearch.service');
const { bumpTenantCacheVersion } = require('../services/cache.service');
const { getOpenSearchClient } = require('../config/opensearch');
const { extractTextFromPdf } = require('../services/pdfExtraction.service');
const { extractTextFromUrl } = require('../services/urlExtraction.service');

const INDEX_NAME = process.env.OPENSEARCH_INDEX || 'rag_chunks';

async function runIngestion({ tenantId, title, text, sourceType, rawText }) {
  let doc;
  try {
    if (!text || !text.trim()) {
      throw Object.assign(new Error('No usable text could be extracted from this source'), { statusCode: 400 });
    }

    doc = await Document.create({
      tenant: tenantId,
      title,
      sourceType,
      rawText: rawText || text,
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
      throw Object.assign(new Error('No chunks produced from input text'), { statusCode: 400 });
    }

    const embeddings = await embed(chunks);
    await addChunks({ tenantId, documentId: doc._id.toString(), chunkTexts: chunks, embeddings });
    await indexChunks({ tenantId, documentId: doc._id.toString(), chunkTexts: chunks });

    doc.chunkCount = chunks.length;
    doc.status = 'ready';
    await doc.save();

    await bumpTenantCacheVersion(tenantId);

    return { documentId: doc._id, title: doc.title, chunkCount: doc.chunkCount, status: doc.status };
  } catch (err) {
    if (doc && doc.status !== 'failed') {
      doc.status = 'failed';
      doc.error = err.message;
      await doc.save().catch(() => {});
    }
    throw err;
  }
}

async function ingestDocument(req, res, next) {
  try {
    const { title, text } = req.body;
    if (!title || !text) return res.status(400).json({ error: 'title and text are required' });
    const result = await runIngestion({ tenantId: req.tenantId, title, text, sourceType: 'text', rawText: text });
    res.status(201).json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
    if (!err.statusCode) next(err);
  }
}

async function ingestPdf(req, res, next) {
  try {
    const { title } = req.body;
    if (!title) return res.status(400).json({ error: 'title is required' });
    if (!req.file) return res.status(400).json({ error: 'pdf file is required' });
    const text = await extractTextFromPdf(req.file.buffer);
    const result = await runIngestion({ tenantId: req.tenantId, title, text, sourceType: 'pdf' });
    res.status(201).json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
    if (!err.statusCode) next(err);
  }
}

async function ingestUrl(req, res, next) {
  try {
    const { title, url } = req.body;
    if (!title || !url) return res.status(400).json({ error: 'title and url are required' });
    const text = await extractTextFromUrl(url);
    const result = await runIngestion({ tenantId: req.tenantId, title, text, sourceType: 'url' });
    res.status(201).json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
    if (!err.statusCode) next(err);
  }
}

async function listDocuments(req, res, next) {
  try {
    const docs = await Document.find({ tenant: req.tenantId })
      .select('title status chunkCount sourceType rawText createdAt')
      .sort({ createdAt: -1 });
    res.json({ documents: docs });
  } catch (err) {
    next(err);
  }
}

async function deleteDocument(req, res, next) {
  try {
    const doc = await Document.findOne({ _id: req.params.id, tenant: req.tenantId });
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    // remove chunks from Chroma
    try {
      const collection = await getCollection();
      const results = await collection.get({ where: { documentId: doc._id.toString() } });
      if (results.ids && results.ids.length > 0) {
        await collection.delete({ ids: results.ids });
      }
    } catch (e) {
      console.error('[delete] chroma cleanup:', e.message);
    }

    // remove chunks from OpenSearch
    try {
      const osClient = getOpenSearchClient();
      await osClient.deleteByQuery({
        index: INDEX_NAME,
        body: {
          query: {
            bool: {
              filter: [
                { term: { tenantId: req.tenantId } },
                { term: { documentId: doc._id.toString() } },
              ],
            },
          },
        },
      });
    } catch (e) {
      console.error('[delete] opensearch cleanup:', e.message);
    }

    await Document.deleteOne({ _id: doc._id });
    await bumpTenantCacheVersion(req.tenantId);

    res.json({ message: 'Document deleted', documentId: doc._id });
  } catch (err) {
    next(err);
  }
}

module.exports = { ingestDocument, ingestPdf, ingestUrl, listDocuments, deleteDocument };