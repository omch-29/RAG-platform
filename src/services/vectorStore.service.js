const { ChromaClient } = require('chromadb');

/**

 */

let clientInstance = null;
let collectionInstance = null;

function getClient() {
  if (!clientInstance) {
    clientInstance = new ChromaClient({ path: process.env.CHROMA_URL });
  }
  return clientInstance;
}

async function getCollection() {
  if (!collectionInstance) {
    const client = getClient();
    const name = process.env.CHROMA_COLLECTION || 'rag_chunks';
    collectionInstance = await client.getOrCreateCollection({ name });
  }
  return collectionInstance;
}

/**
 * Adds chunks for a given tenant/document into the vector store.
 * @param {string} tenantId
 * @param {string} documentId
 * @param {string[]} chunkTexts
 * @param {number[][]} embeddings
 */
async function addChunks({ tenantId, documentId, chunkTexts, embeddings }) {
  if (chunkTexts.length !== embeddings.length) {
    throw new Error('addChunks: chunkTexts and embeddings length mismatch');
  }

  const collection = await getCollection();

  const ids = chunkTexts.map((_, i) => `${documentId}-chunk-${i}`);
  const metadatas = chunkTexts.map((_, i) => ({
    tenantId,
    documentId,
    chunkIndex: i,
  }));

  await collection.add({
    ids,
    embeddings,
    metadatas,
    documents: chunkTexts,
  });

  return ids;
}

/**
 * Retrieves the top-K most relevant chunks for a tenant given a query
 
 */
async function queryChunks({ tenantId, queryEmbedding, topK = 4 }) {
  if (!tenantId) {
    throw new Error('queryChunks: tenantId is required for isolation — refusing to query without it');
  }

  const collection = await getCollection();

  const results = await collection.query({
    queryEmbeddings: [queryEmbedding],
    nResults: topK,
    where: { tenantId },
  });

  // chromadb returns parallel arrays nested one level for the single query
  const documents = results.documents?.[0] || [];
  const metadatas = results.metadatas?.[0] || [];
  const distances = results.distances?.[0] || [];

  return documents.map((text, i) => ({
    text,
    metadata: metadatas[i],
    distance: distances[i], // lower = more similar (cosine distance)
  }));
}

module.exports = { addChunks, queryChunks };