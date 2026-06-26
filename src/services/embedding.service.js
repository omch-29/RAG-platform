

const { hashKey, getCached, setCached } = require('./cache.service');

let embedderPromise = null;

async function getEmbedder() {
  if (!embedderPromise) {
  
    const { pipeline } = await import('@xenova/transformers');
    const modelName = process.env.EMBEDDING_MODEL || 'Xenova/all-MiniLM-L6-v2';
    console.log(`[embedding] loading model: ${modelName} (first call only)`);
    embedderPromise = pipeline('feature-extraction', modelName);
  }
  return embedderPromise;
}

function embeddingCacheKey(text) {
  // model name is part of the key 
  const modelName = process.env.EMBEDDING_MODEL || 'Xenova/all-MiniLM-L6-v2';
  return `embcache:${modelName}:${hashKey(text)}`;
}

async function embedOne(text) {
  const cacheKey = embeddingCacheKey(text);

  const cached = await getCached(cacheKey);
  if (cached) {
    return cached; // cache hit — skipped the CPU-bound model entirely
  }

  const embedder = await getEmbedder();
  const output = await embedder(text, { pooling: 'mean', normalize: true });
  const vector = Array.from(output.data);

  // embeddings 
  await setCached(cacheKey, vector, null);

  return vector;
}

/**
 * Embeds a single string or an array of strings, transparently using the
 * Redis embedding cache per-text (so within a batch, some chunks can be
 * cache hits and others cache misses — each text is checked independently).
 * Returns: number[] for a single string, number[][] for an array.
 */
async function embed(input) {
  const isBatch = Array.isArray(input);
  const texts = isBatch ? input : [input];

  const vectors = [];
  for (const text of texts) {
    vectors.push(await embedOne(text));
  }

  return isBatch ? vectors : vectors[0];
}

module.exports = { embed };