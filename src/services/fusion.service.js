/**
 
 */

function fuseResults({ vectorResults, bm25Results, topK = 4, k = 60 }) {
  const scores = new Map(); // id -> { text, metadata, rrfScore, vectorRank, bm25Rank }

  vectorResults.forEach((result, index) => {
    const rank = index + 1; 
    const id = result.metadata.documentId + '-chunk-' + result.metadata.chunkIndex;
    const contribution = 1 / (k + rank);

    scores.set(id, {
      text: result.text,
      metadata: result.metadata,
      rrfScore: contribution,
      vectorRank: rank,
      vectorDistance: result.distance,
      bm25Rank: null,
      bm25Score: null,
    });
  });

  bm25Results.forEach((result, index) => {
    const rank = index + 1; // bm25Results already sorted for best first
    const id = result.id;
    const contribution = 1 / (k + rank);

    if (scores.has(id)) {
      const existing = scores.get(id);
      existing.rrfScore += contribution;
      existing.bm25Rank = rank;
      existing.bm25Score = result.bm25Score;
    } else {
      scores.set(id, {
        text: result.text,
        metadata: result.metadata,
        rrfScore: contribution,
        vectorRank: null,
        vectorDistance: null,
        bm25Rank: rank,
        bm25Score: result.bm25Score,
      });
    }
  });

  const fused = Array.from(scores.values()).sort((a, b) => b.rrfScore - a.rrfScore);

  return fused.slice(0, topK);
}

module.exports = { fuseResults };