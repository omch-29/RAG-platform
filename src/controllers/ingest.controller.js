// const Document = require('../models/Document');
// const { chunkText } = require('../services/chunking.service');
// const { embed } = require('../services/embedding.service');
// const { addChunks } = require('../services/vectorStore.service');

// /**
//  * POST /api/ingest
//  * Body: { title: string, text: string }
//  *
//  * Pipeline: create Document record -> chunk text -> embed each chunk
//  * (batched) -> store chunks + embeddings in Chroma, tagged with tenantId
//  * -> mark Document ready.
//  *
//  * Admin-only (enforced by requireAdmin middleware on the route) because
//  * ingesting documents changes what every user in the tenant can retrieve.
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

//     const embeddings = await embed(chunks); // batched: array in, array of vectors out

//     await addChunks({
//       tenantId: req.tenantId,
//       documentId: doc._id.toString(),
//       chunkTexts: chunks,
//       embeddings,
//     });

//     doc.chunkCount = chunks.length;
//     doc.status = 'ready';
//     await doc.save();

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
const { addChunks } = require('../services/vectorStore.service');
const { indexChunks } = require('../services/keywordSearch.service');

/**
 * POST /api/ingest
 * Body: { title: string, text: string }
 *
 * Pipeline: create Document record -> chunk text -> embed each chunk
 * (batched) -> store chunks + embeddings in Chroma (vector/semantic
 * search) AND index the same chunks in OpenSearch (BM25 keyword search),
 * both tagged with tenantId -> mark Document ready.
 *
 * Both stores receive the SAME chunk text and the SAME chunk IDs
 * (`${documentId}-chunk-${i}`) — this is what makes hybrid fusion
 * possible later: a chunk found by both retrieval methods can be
 * matched by ID across the two result sets.
 *
 * Admin-only (enforced by requireAdmin middleware on the route) because
 * ingesting documents changes what every user in the tenant can retrieve.
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