const { embed } = require('../services/embedding.service');
const { queryChunks } = require('../services/vectorStore.service');
const { searchChunks } = require('../services/keywordSearch.service');
const { fuseResults } = require('../services/fusion.service');
const { streamAnswer } = require('../services/llm.service');
const { hashKey, getCached, setCached, getTenantCacheVersion } = require('../services/cache.service');
const { recordUsage } = require('../services/usage.service');

const QUERY_CACHE_TTL_SECONDS = parseInt(process.env.QUERY_CACHE_TTL_SECONDS, 10) || 300;
const RRF_K = parseInt(process.env.RRF_K, 10) || 60;
const RRF_CANDIDATE_POOL = parseInt(process.env.RRF_CANDIDATE_POOL, 10) || 10;

async function queryCacheKey(tenantId, question) {
  const version = await getTenantCacheVersion(tenantId);
  return `querycache:${tenantId}:v${version}:${hashKey(question.trim().toLowerCase())}`;
}

/**
 * GET /api/query/stream?question=...&token=...
 *
 * Same retrieval pipeline as the non-streaming /api/query (cache check,
 * hybrid vector+BM25 retrieval, RRF fusion), but the generation step
 * streams tokens to the client via Server-Sent Events as they arrive
 * from Groq, instead of waiting for the full answer.
 *
 * On a cache hit, there's no token-by-token generation to stream — the
 * full cached answer is sent as a single SSE event immediately. This is
 * a deliberate simplification: re-streaming a cached string token-by-token
 * would only add artificial latency with no real benefit.
 */
async function queryStream(req, res, next) {
  const { question } = req.query;

  if (!question || typeof question !== 'string') {
    return res.status(400).json({ error: 'question query parameter is required' });
  }

  // SSE headers — keep the connection open, no buffering/caching by proxies
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders();

  const sendEvent = (eventName, data) => {
    res.write(`event: ${eventName}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const cacheKey = await queryCacheKey(req.tenantId, question);
    const cachedResult = await getCached(cacheKey);

    if (cachedResult) {
      sendEvent('token', { text: cachedResult.answer });
      sendEvent('done', { ...cachedResult, cached: true });
      return res.end();
    }

    const topK = parseInt(process.env.TOP_K, 10) || 4;
    const queryEmbedding = await embed(question);

    const [vectorResults, bm25Results] = await Promise.all([
      queryChunks({ tenantId: req.tenantId, queryEmbedding, topK: RRF_CANDIDATE_POOL }),
      searchChunks({ tenantId: req.tenantId, queryText: question, size: RRF_CANDIDATE_POOL }),
    ]);

    const fusedChunks = fuseResults({ vectorResults, bm25Results, topK, k: RRF_K });

    sendEvent('sources', {
      sources: fusedChunks.map((c) => ({
        documentId: c.metadata.documentId,
        chunkIndex: c.metadata.chunkIndex,
        rrfScore: c.rrfScore,
        vectorRank: c.vectorRank,
        bm25Rank: c.bm25Rank,
        preview: c.text.slice(0, 150),
      })),
    });

    const { answer, usage } = await streamAnswer(question, fusedChunks, (tokenText) => {
      sendEvent('token', { text: tokenText });
    });

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

    sendEvent('done', { ...result, cached: false });
    res.end();
  } catch (err) {
    sendEvent('error', { error: err.message });
    res.end();
  }
}

module.exports = { queryStream };