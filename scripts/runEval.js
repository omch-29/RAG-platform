require('dotenv').config();

const { documents, queries } = require('../eval/dataset');
const { chunkText } = require('../src/services/chunking.service');
const { embed } = require('../src/services/embedding.service');
const { addChunks } = require('../src/services/vectorStore.service');
const { indexChunks, searchChunks } = require('../src/services/keywordSearch.service');
const { queryChunks } = require('../src/services/vectorStore.service');
const { fuseResults } = require('../src/services/fusion.service');
const { evaluateQuery, average } = require('../src/services/evaluation.service');

// A fixed, dedicated tenant ID for eval data — separate from any real
// tenant so eval runs never mix with or pollute real ingested data.
const EVAL_TENANT_ID = 'eval-tenant-fixed-id';

const TOP_K = parseInt(process.env.TOP_K, 10) || 4;
const RRF_K = parseInt(process.env.RRF_K, 10) || 60;
const RRF_CANDIDATE_POOL = parseInt(process.env.RRF_CANDIDATE_POOL, 10) || 10;

async function ingestEvalDocuments() {
  const titleToDocumentId = {};

  for (let i = 0; i < documents.length; i++) {
    const { title, text } = documents[i];
    const documentId = `eval-doc-${i}`;
    titleToDocumentId[title] = documentId;

    const chunkSize = parseInt(process.env.CHUNK_SIZE, 10) || 500;
    const overlap = parseInt(process.env.CHUNK_OVERLAP, 10) || 50;
    const chunks = chunkText(text, { chunkSize, overlap });

    const embeddings = await embed(chunks);

    await addChunks({ tenantId: EVAL_TENANT_ID, documentId, chunkTexts: chunks, embeddings });
    await indexChunks({ tenantId: EVAL_TENANT_ID, documentId, chunkTexts: chunks });

    console.log(`[eval] ingested "${title}" -> ${chunks.length} chunk(s)`);
  }

  return titleToDocumentId;
}

async function runQuery(question) {
  const queryEmbedding = await embed(question);

  const [vectorResults, bm25Results] = await Promise.all([
    queryChunks({ tenantId: EVAL_TENANT_ID, queryEmbedding, topK: RRF_CANDIDATE_POOL }),
    searchChunks({ tenantId: EVAL_TENANT_ID, queryText: question, size: RRF_CANDIDATE_POOL }),
  ]);

  const fused = fuseResults({ vectorResults, bm25Results, topK: TOP_K, k: RRF_K });

  // documentId is what we score against — ground truth is labeled at the
  // document level (see dataset.js comment on why that's a fair
  // simplification for this small corpus)
  return fused.map((chunk) => chunk.metadata.documentId);
}

async function main() {
  console.log('=== Retrieval Evaluation ===\n');
  console.log(`Config: TOP_K=${TOP_K}, RRF_K=${RRF_K}, candidate pool=${RRF_CANDIDATE_POOL}\n`);

  const titleToDocumentId = await ingestEvalDocuments();
  console.log('');

  const results = [];

  for (const { question, relevantTitles } of queries) {
    const relevantIds = relevantTitles.map((title) => titleToDocumentId[title]);
    const retrievedIds = await runQuery(question);

    const { precision, recall } = evaluateQuery(retrievedIds, relevantIds);

    results.push({ question, relevantTitles, precision, recall });

    console.log(`Q: "${question}"`);
    console.log(`   expected: ${relevantTitles.join(', ')}`);
    console.log(`   precision@${TOP_K}: ${precision.toFixed(2)}  |  recall@${TOP_K}: ${recall.toFixed(2)}`);
    console.log('');
  }

  const avgPrecision = average(results.map((r) => r.precision));
  const avgRecall = average(results.map((r) => r.recall));

  console.log('=== Summary ===');
  console.log(`Average precision@${TOP_K}: ${avgPrecision.toFixed(3)}`);
  console.log(`Average recall@${TOP_K}:    ${avgRecall.toFixed(3)}`);

  process.exit(0);
}

main().catch((err) => {
  console.error('[eval] failed:', err);
  process.exit(1);
});