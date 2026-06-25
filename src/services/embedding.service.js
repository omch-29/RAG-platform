// /**
//  * Embedding service using @xenova/transformers — runs the embedding model
//  * directly in Node on CPU via ONNX runtime. No external API call, no cost.
//  *
//  * Model: all-MiniLM-L6-v2 (384-dimensional output, ~80MB).
//  * Chosen specifically for being lightweight enough to run on a laptop
//  * without a GPU, while still being a widely-used, well-benchmarked
//  * sentence-embedding model — not a toy choice, a real production-tier
//  * embedding model that happens to also be small.
//  *
//  * The pipeline is lazily initialized once and reused across all calls —
//  * loading the model on every request would be both slow and wasteful.
//  */

// let embedderPromise = null;

// async function getEmbedder() {
//   if (!embedderPromise) {
//     // dynamic import because @xenova/transformers is an ESM package
//     const { pipeline } = await import('@xenova/transformers');
//     const modelName = process.env.EMBEDDING_MODEL || 'Xenova/all-MiniLM-L6-v2';
//     console.log(`[embedding] loading model: ${modelName} (first call only)`);
//     embedderPromise = pipeline('feature-extraction', modelName);
//   }
//   return embedderPromise;
// }

// /**
//  * Embeds a single string or an array of strings.
//  * Returns: number[] for a single string, number[][] for an array.
//  */
// async function embed(input) {
//   const embedder = await getEmbedder();
//   const isBatch = Array.isArray(input);
//   const texts = isBatch ? input : [input];

//   const vectors = [];
//   for (const text of texts) {
//     const output = await embedder(text, { pooling: 'mean', normalize: true });
//     vectors.push(Array.from(output.data));
//   }

//   return isBatch ? vectors : vectors[0];
// }

// module.exports = { embed };

/**
 * Embedding service using @xenova/transformers — runs the embedding model
 * directly in Node on CPU via ONNX runtime. No external API call, no cost.
 *
 * Model: all-MiniLM-L6-v2 (384-dimensional output, ~80MB).
 * Chosen specifically for being lightweight enough to run on a laptop
 * without a GPU, while still being a widely-used, well-benchmarked
 * sentence-embedding model — not a toy choice, a real production-tier
 * embedding model that happens to also be small.
 *
 * The pipeline is lazily initialized once and reused across all calls —
 * loading the model on every request would be both slow and wasteful.
 */

const { hashKey, getCached, setCached } = require('./cache.service');

let embedderPromise = null;

async function getEmbedder() {
  if (!embedderPromise) {
    // dynamic import because @xenova/transformers is an ESM package
    const { pipeline } = await import('@xenova/transformers');
    const modelName = process.env.EMBEDDING_MODEL || 'Xenova/all-MiniLM-L6-v2';
    console.log(`[embedding] loading model: ${modelName} (first call only)`);
    embedderPromise = pipeline('feature-extraction', modelName);
  }
  return embedderPromise;
}

function embeddingCacheKey(text) {
  // model name is part of the key — if you ever swap embedding models,
  // old cached vectors (different dimensionality/space) must not be reused
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

  // embeddings are deterministic for a given text+model, so no TTL needed
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