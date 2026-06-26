/**
 * Phase 1 chunking strategy: fixed-size word-count windows with overlap.
 *
 
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
    start = end - overlap; 
  }

  return chunks;
}

module.exports = { chunkText };