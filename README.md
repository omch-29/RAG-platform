# RAG Platform

A multi-tenant API that lets a company plug their own documentation into a
hosted Q&A endpoint — ask questions in plain English, get answers grounded
in their actual docs, with every answer showing exactly which passages it
came from.

I built this to go deeper than the typical "chat with your PDF" tutorial.
Most RAG demos treat retrieval as a single API call. In practice, the hard
part is everything around that call: keeping one tenant's data from ever
leaking into another's, retrieving the right chunks reliably (not just
"close enough" semantically), caching correctly without serving stale
answers, and knowing whether retrieval is actually working instead of just
eyeballing the output. This project is my attempt at building that properly.

What it does


A company signs up, gets their own isolated workspace (tenant)
They upload documentation — pasted text, a PDF, or a URL to scrape
Anyone in their workspace can ask questions and get streamed, grounded
answers, with the exact source passages shown alongside each answer
The admin can invite teammates into the same workspace
Usage and estimated cost are tracked per workspace


Why it's built the way it is

Hybrid search, not just vector search. Pure semantic search misses
exact technical terms — error codes, header names, version numbers — that
don't carry much "meaning" on their own. Pure keyword search misses
paraphrased questions. So every query runs through both a vector search
(ChromaDB) and a real BM25 keyword search (OpenSearch) in parallel, and the
two ranked lists get merged with Reciprocal Rank Fusion. Whichever method
actually found the right chunk for a given question, that's the one that
wins.

Caching that doesn't go stale. There are two separate caches for two
separate reasons: one caches embeddings (so identical text never gets
re-embedded — saves CPU), and one caches full answers (so identical
questions skip the LLM call entirely — saves cost and time). The tricky
part was making sure a cached answer never outlives the data it was based
on — ingesting a new document bumps a version counter per tenant, so old
cached answers for that tenant become unreachable immediately, without
needing to scan and delete anything.

Multi-tenancy enforced everywhere, not just at the app layer. Every
single read from the vector store, the keyword index, and the cache is
filtered by tenant ID. There's no code path that can query across tenants
by accident.

Retrieval quality you can actually measure. There's a labeled
evaluation script (npm run eval) that ingests a small known dataset, runs
real questions through the real retrieval pipeline, and reports
precision@k and recall@k — not vibes.

How a request actually flows

A question comes in → the API checks if this exact question was answered
recently for this tenant (Redis) → if not, the question gets embedded and
searched two ways at once: semantically against ChromaDB, and by keyword
against OpenSearch → both result lists get merged into one ranked list →
those top chunks get handed to Groq's LLM with instructions to answer only
from what's given → the answer streams back to the user, along with which
chunks it came from and how each one ranked.

MongoDB sits off to the side the whole time, holding tenant/user accounts
and usage records — it's never part of the actual answer-generation path.

Stack

Node.js / Express · MongoDB · ChromaDB · OpenSearch · Redis · Groq ·
Docker · Kubernetes (manifests included, see k8s/) · AWS EC2