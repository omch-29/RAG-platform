/**
 * Reciprocal Rank Fusion (RRF) — the standard, well-documented technique
 * for combining two independently-ranked result lists into one.
 *
 * Why RRF and not a weighted score average: vector distances (cosine,
 * roughly 0-2 range) and BM25 scores (unbounded, can be 0-20+ depending
 * on term frequency/corpus) live on completely different scales. Averaging
 * raw scores from two different scales is mathematically meaningless
 * without careful normalization. RRF sidesteps this entirely by using
 * each result's RANK POSITION (1st, 2nd, 3rd...) instead of its raw
 * score — rank position is always comparable regardless of how the
 * underlying score was computed.
 *
 * Formula per chunk: score = sum over each list it appears in of
 * 1 / (k + rank), where rank is 1-indexed position in that list.
 * A chunk that ranks highly in BOTH vector and BM25 search scores higher
 * than one that only appears in one list — which is exactly the
 * "hybrid" behavior we want: technical exact-match terms (BM25 strength)
 * and conceptual similarity (vector strength) both contribute.
 *
 * k=60 is the standard constant from the original RRF paper (Cormack et
 * al.) — it dampens the impact of rank differences at the bottom of the
 * list while still rewarding top ranks meaningfully.
 */

function fuseResults({ vectorResults, bm25Results, topK = 4, k = 60 }) {
  const scores = new Map(); // id -> { text, metadata, rrfScore, vectorRank, bm25Rank }

  vectorResults.forEach((result, index) => {
    const rank = index + 1; // vectorResults already sorted by distance ascending (best first)
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
    const rank = index + 1; // bm25Results already sorted by score descending (best first)
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