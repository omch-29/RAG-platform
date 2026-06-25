
// const { embed } = require('../services/embedding.service');
// const { queryChunks } = require('../services/vectorStore.service');
// const { generateAnswer } = require('../services/llm.service');
// const { hashKey, getCached, setCached } = require('../services/cache.service');

// function queryCacheKey(tenantId, question) {
//   // tenantId is part of the key deliberately — without it, two tenants
//   // asking the same question would share a cached answer, which is a
//   // tenant-isolation leak through the cache layer.
//   return `querycache:${tenantId}:${hashKey(question.trim().toLowerCase())}`;
// }

// const QUERY_CACHE_TTL_SECONDS = parseInt(process.env.QUERY_CACHE_TTL_SECONDS, 10) || 300;

// /**
//  * POST /api/query
//  * Body: { question: string }
//  *
//  * Pipeline (Phase 2): check query-result cache (tenant-scoped) -> on miss,
//  * embed question (itself cache-checked inside embed()) -> retrieve top-K
//  * chunks scoped to req.tenantId -> generate grounded answer -> cache the
//  * full result before returning.
//  */
// async function queryDocuments(req, res, next) {
//   try {
//     const { question } = req.body;

//     if (!question || typeof question !== 'string') {
//       return res.status(400).json({ error: 'question is required' });
//     }

//     const cacheKey = queryCacheKey(req.tenantId, question);

//     const cachedResult = await getCached(cacheKey);
//     if (cachedResult) {
//       return res.json({ ...cachedResult, cached: true });
//     }

//     const topK = parseInt(process.env.TOP_K, 10) || 4;

//     const queryEmbedding = await embed(question); // cache-checked internally per-text

//     const retrievedChunks = await queryChunks({
//       tenantId: req.tenantId,
//       queryEmbedding,
//       topK,
//     });

//     const { answer, usage } = await generateAnswer(question, retrievedChunks);

//     const result = {
//       question,
//       answer,
//       sources: retrievedChunks.map((c) => ({
//         documentId: c.metadata.documentId,
//         chunkIndex: c.metadata.chunkIndex,
//         distance: c.distance,
//         preview: c.text.slice(0, 150),
//       })),
//       usage,
//     };

//     await setCached(cacheKey, result, QUERY_CACHE_TTL_SECONDS);

//     res.json({ ...result, cached: false });
//   } catch (err) {
//     next(err);
//   }
// }

// module.exports = { queryDocuments };

const { embed } = require('../services/embedding.service');
const { queryChunks } = require('../services/vectorStore.service');
const { searchChunks } = require('../services/keywordSearch.service');
const { fuseResults } = require('../services/fusion.service');
const { generateAnswer } = require('../services/llm.service');
const { hashKey, getCached, setCached } = require('../services/cache.service');
const { recordUsage, getTenantUsage } = require('../services/usage.service');

function queryCacheKey(tenantId, question) {
  return `querycache:${tenantId}:${hashKey(question.trim().toLowerCase())}`;
}

const QUERY_CACHE_TTL_SECONDS = parseInt(process.env.QUERY_CACHE_TTL_SECONDS, 10) || 300;
const RRF_K = parseInt(process.env.RRF_K, 10) || 60;
const RRF_CANDIDATE_POOL = parseInt(process.env.RRF_CANDIDATE_POOL, 10) || 10;

/**
 * POST /api/query
 * Body: { question: string }
 */
async function queryDocuments(req, res, next) {
  try {
    const { question } = req.body;

    if (!question || typeof question !== 'string') {
      return res.status(400).json({ error: 'question is required' });
    }

    const cacheKey = queryCacheKey(req.tenantId, question);

    const cachedResult = await getCached(cacheKey);
    if (cachedResult) {
      // no real Groq call happened — nothing to add to usage/cost
      return res.json({ ...cachedResult, cached: true });
    }

    const topK = parseInt(process.env.TOP_K, 10) || 4;

    const queryEmbedding = await embed(question);

    const [vectorResults, bm25Results] = await Promise.all([
      queryChunks({ tenantId: req.tenantId, queryEmbedding, topK: RRF_CANDIDATE_POOL }),
      searchChunks({ tenantId: req.tenantId, queryText: question, size: RRF_CANDIDATE_POOL }),
    ]);

    const fusedChunks = fuseResults({ vectorResults, bm25Results, topK, k: RRF_K });

    const { answer, usage } = await generateAnswer(question, fusedChunks);

    await recordUsage({ tenantId: req.tenantId, usage });

    const result = {
      question,
      answer,
      sources: fusedChunks.map((c) => ({
        documentId: c.metadata.documentId,
        chunkIndex: c.metadata.chunkIndex,
        rrfScore: c.rrfScore,
        vectorRank: c.vectorRank,
        bm25Rank: c.bm25Rank,
        preview: c.text.slice(0, 150),
      })),
      usage,
    };

    await setCached(cacheKey, result, QUERY_CACHE_TTL_SECONDS);

    res.json({ ...result, cached: false });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/query/usage
 * Returns this tenant's per-day usage history + running totals
 * (request count, tokens, estimated cost).
 */
async function getUsage(req, res, next) {
  try {
    const usage = await getTenantUsage(req.tenantId);
    res.json(usage);
  } catch (err) {
    next(err);
  }
}

module.exports = { queryDocuments, getUsage };