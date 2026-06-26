

const { embed } = require('../services/embedding.service');
const { queryChunks } = require('../services/vectorStore.service');
const { searchChunks } = require('../services/keywordSearch.service');
const { fuseResults } = require('../services/fusion.service');
const { generateAnswer } = require('../services/llm.service');
const { hashKey, getCached, setCached, getTenantCacheVersion } = require('../services/cache.service');
const { recordUsage, getTenantUsage } = require('../services/usage.service');

async function queryCacheKey(tenantId, question) {
  const version = await getTenantCacheVersion(tenantId);
  return `querycache:${tenantId}:v${version}:${hashKey(question.trim().toLowerCase())}`;
}

const QUERY_CACHE_TTL_SECONDS = parseInt(process.env.QUERY_CACHE_TTL_SECONDS, 10) || 300;
const RRF_K = parseInt(process.env.RRF_K, 10) || 60;
const RRF_CANDIDATE_POOL = parseInt(process.env.RRF_CANDIDATE_POOL, 10) || 10;

async function queryDocuments(req, res, next) {
  try {
    const { question } = req.body;

    if (!question || typeof question !== 'string') {
      return res.status(400).json({ error: 'question is required' });
    }

    const cacheKey = await queryCacheKey(req.tenantId, question);

    const cachedResult = await getCached(cacheKey);
    if (cachedResult) {
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

async function getUsage(req, res, next) {
  try {
    const usage = await getTenantUsage(req.tenantId);
    res.json(usage);
  } catch (err) {
    next(err);
  }
}

module.exports = { queryDocuments, getUsage };