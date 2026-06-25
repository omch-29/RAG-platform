/**
 * Standard information-retrieval metrics, computed against a ranked list
 * of retrieved document/chunk IDs and a ground-truth set of relevant IDs.
 *
 * precision@k: of the k chunks we retrieved, what fraction were actually
 * relevant? Measures how much noise/irrelevant content gets handed to
 * the LLM — high noise increases hallucination risk and wastes tokens.
 *
 * recall@k: of all the relevant chunks that exist, what fraction did we
 * successfully retrieve in our top k? Measures whether the system is
 * missing genuinely relevant content — a recall miss means the LLM
 * never even saw the right source, so it cannot possibly answer
 * correctly regardless of how good the generation step is.
 */

function precisionAtK(retrievedIds, relevantIds) {
  if (retrievedIds.length === 0) return 0;
  const relevantSet = new Set(relevantIds);
  const hits = retrievedIds.filter((id) => relevantSet.has(id)).length;
  return hits / retrievedIds.length;
}

function recallAtK(retrievedIds, relevantIds) {
  if (relevantIds.length === 0) return 1; // nothing relevant exists — vacuously satisfied
  const retrievedSet = new Set(retrievedIds);
  const hits = relevantIds.filter((id) => retrievedSet.has(id)).length;
  return hits / relevantIds.length;
}

function evaluateQuery(retrievedIds, relevantIds) {
  return {
    precision: precisionAtK(retrievedIds, relevantIds),
    recall: recallAtK(retrievedIds, relevantIds),
  };
}

function average(numbers) {
  if (numbers.length === 0) return 0;
  return numbers.reduce((sum, n) => sum + n, 0) / numbers.length;
}

module.exports = { precisionAtK, recallAtK, evaluateQuery, average };