/**
 * Phase 1 chunking strategy: fixed-size word-count windows with overlap.
 *
 * Why word-count and not character-count: embedding models have a token
 * limit, and word count is a much closer proxy for token count than raw
 * characters (avg ~0.75 words per token for English). Character-based
 * chunking risks truncating mid-sentence far more often.
 *
 * Why overlap matters: without overlap, a sentence that contains the
 * answer to a query can get split exactly at the chunk boundary, so
 * neither chunk alone has enough context to be retrieved as relevant.
 * Overlap re-includes the tail of chunk N at the start of chunk N+1.
 *
 * This is intentionally simple for Phase 1. Known limitation we are NOT
 * solving yet: it does not respect sentence/paragraph boundaries, so a
 * chunk can cut a sentence in half. Semantic/recursive chunking is a
 * later, optional upgrade once the rest of the pipeline is proven.
 */

function chunkText(text, { chunkSize = 500, overlap = 50 } = {}) {
  if (!text || typeof text !== 'string') {
    throw new Error('chunkText: text must be a non-empty string');
  }
  if (overlap >= chunkSize) {
    throw new Error('chunkText: overlap must be smaller than chunkSize');
  }

  const words = text.trim().split(/\s+/);
  const chunks = [];

  let start = 0;
  while (start < words.length) {
    const end = Math.min(start + chunkSize, words.length);
    const chunkWords = words.slice(start, end);
    chunks.push(chunkWords.join(' '));

    if (end === words.length) break;
    start = end - overlap; // step forward but re-include the overlap tail
  }

  return chunks;
}

module.exports = { chunkText };