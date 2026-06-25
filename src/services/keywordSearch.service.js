const { getOpenSearchClient } = require('../config/opensearch');

/**
 * Mirrors the multi-tenancy pattern used in vectorStore.service.js: ONE
 * shared OpenSearch index, every chunk document tagged with `tenantId`,
 * filtered on every search via a `term` query — never a separate index
 * per tenant. Same reasoning as the Chroma collection: operational
 * simplicity at scale, isolation enforced by a mandatory filter instead
 * of physical separation.
 *
 * Chunk document IDs are kept identical to the ones used in Chroma
 * (`${documentId}-chunk-${i}`) so that fusion (combining vector + BM25
 * results) can match chunks across both retrieval systems by ID.
 */

const INDEX_NAME = process.env.OPENSEARCH_INDEX || 'rag_chunks';

let indexEnsured = false;

async function ensureIndex() {
  if (indexEnsured) return;

  const client = getOpenSearchClient();
  const exists = await client.indices.exists({ index: INDEX_NAME });

  if (!exists.body) {
    await client.indices.create({
      index: INDEX_NAME,
      body: {
        mappings: {
          properties: {
            tenantId: { type: 'keyword' },
            documentId: { type: 'keyword' },
            chunkIndex: { type: 'integer' },
            // default "text" type uses Lucene's BM25 similarity out of
            // the box — this is real BM25 scoring, not an approximation
            text: { type: 'text' },
          },
        },
      },
    });
  }

  indexEnsured = true;
}

/**
 * Bulk-indexes chunks for BM25 search. Mirrors addChunks() in
 * vectorStore.service.js — same inputs, different storage engine.
 */
async function indexChunks({ tenantId, documentId, chunkTexts }) {
  await ensureIndex();
  const client = getOpenSearchClient();

  const body = chunkTexts.flatMap((text, i) => [
    { index: { _index: INDEX_NAME, _id: `${documentId}-chunk-${i}` } },
    { tenantId, documentId, chunkIndex: i, text },
  ]);

  const response = await client.bulk({ body, refresh: true });

  if (response.body.errors) {
    const failedItems = response.body.items.filter((item) => item.index?.error);
    throw new Error(`OpenSearch bulk indexing errors: ${JSON.stringify(failedItems)}`);
  }
}

/**
 * BM25 keyword search scoped to a tenant. Returns chunks ranked by
 * OpenSearch's relevance score (real BM25, via the `match` query against
 * the `text` field's default similarity).
 */
async function searchChunks({ tenantId, queryText, size = 10 }) {
  if (!tenantId) {
    throw new Error('searchChunks: tenantId is required for isolation — refusing to search without it');
  }

  await ensureIndex();
  const client = getOpenSearchClient();

  const response = await client.search({
    index: INDEX_NAME,
    body: {
      size,
      query: {
        bool: {
          must: [{ match: { text: queryText } }],
          filter: [{ term: { tenantId } }],
        },
      },
    },
  });

  return response.body.hits.hits.map((hit) => ({
    id: hit._id,
    text: hit._source.text,
    metadata: {
      tenantId: hit._source.tenantId,
      documentId: hit._source.documentId,
      chunkIndex: hit._source.chunkIndex,
    },
    bm25Score: hit._score, // higher = more relevant (opposite direction from Chroma's distance)
  }));
}

module.exports = { indexChunks, searchChunks };