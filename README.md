# DocuRAG — Multi-Tenant RAG Platform

A production-engineered Retrieval-Augmented Generation API. Not a "chat with your PDF" demo — a multi-tenant platform where companies upload their own documentation and their team gets grounded, source-cited answers to questions about it, with hybrid search, streaming responses, measured retrieval quality, and per-tenant cost tracking.

---

## The problem this solves

Most RAG tutorials show you how to embed some text, search it, and call an LLM. The actually hard parts are:

- Making sure Company A's documents are never retrievable by Company B, even under caching failures or race conditions
- Getting retrieval right for both conceptual questions AND exact technical terms — pure vector search fails the second kind, pure keyword search fails the first
- Knowing whether retrieval is actually working without eyeballing sample outputs
- Not paying to re-embed the same text or re-run the same LLM call twice
- Tracking what each tenant is actually costing you at the token level

---

## How a request flows

```
User asks a question
         │
         ▼
   Express API — JWT auth
   extracts tenantId from token (zero DB calls)
         │
         ▼
   Rate limit check — Redis
   key: "ratelimit:{tenantId}:{minuteBucket}"
   INCR → if count > 20 → 429 Too Many Requests
         │
         ▼
   Query cache check — Redis
   key: "querycache:{tenantId}:v{version}:{hash(question)}"
   ── HIT ──────────────────────────► return cached answer immediately
         │ MISS
         ▼
   Embed the question
   MiniLM model, local CPU, no API cost
   embedding cache checked first (Redis)
         │
         ├──────────────────┐
         ▼                  ▼
   ChromaDB            OpenSearch
   vector search       BM25 keyword search
   cosine similarity   literal term scoring
   on 384-dim vectors  on raw text
         │                  │
         └────────┬──────────┘
                  ▼
        Reciprocal Rank Fusion
        merges both ranked lists
        into one final top-K
                  │
                  ▼
         Groq LLM (Llama 3.1)
         question + retrieved chunks
         answer ONLY from context
         stream tokens via SSE
                  │
                  ▼
         Record token usage + cost (MongoDB)
         Cache full result (Redis, 300s TTL)
                  │
                  ▼
         Grounded, cited answer
         with retrieval ledger
```

---

## Ingestion pipeline

```
Raw input: text
         │
         ▼
   Text extraction
   Text → used directly
         │
         ▼
   chunkText()
   500-word windows, 50-word overlap
   overlap ensures sentences cut at
   boundaries still appear complete
   in the neighboring chunk
         │
         ├──────────────────────────┐
         ▼                          ▼
   embed(chunks)              indexChunks()
   MiniLM → 384-dim vector    OpenSearch bulk index
   per chunk                  raw text + metadata
   Redis embedding cache      tenantId, documentId,
   checked/stored per chunk   chunkIndex
         │
         ▼
   addChunks()
   ChromaDB collection.add()
   vector + text + metadata per chunk
   {tenantId, documentId, chunkIndex}
         │
         ▼
   bumpTenantCacheVersion()
   Redis INCR on version counter
   old cached answers become
   unreachable immediately
```

---

## Multi-tenancy — enforced at every layer

Every read and write is filtered by `tenantId`, not just at the app layer:

- **ChromaDB** — every `.query()` has `where: { tenantId }`. Filter runs inside the vector store.
- **OpenSearch** — every search has `filter: [{ term: { tenantId } }]`. Same at the keyword layer.
- **Redis (query cache)** — key includes `tenantId`. Different workspaces never share a cached answer.
- **Redis (rate limit)** — key includes `tenantId`. Each organization has its own counter, shared across all its members.
- **MongoDB** — every Document, Usage, and User has a `tenant` field filtered on every query.

There is no code path that reads from any of these stores without a `tenantId`.

---

## Caching — two layers, two different reasons

**Embedding cache**
- Key: `embcache:{modelName}:{SHA256(text)}`
- TTL: none — permanent
- Why: same text + same model always produces the same vector. It's a pure function. Never goes stale. Re-running the CPU-bound embedding model on already-embedded text is pure waste.

**Query result cache**
- Key: `querycache:{tenantId}:v{version}:{SHA256(question)}`
- TTL: 300 seconds
- Why: repeated questions shouldn't pay another Groq API call. The `v{version}` in the key is a per-tenant counter stored in Redis. Ingesting a new document increments it — making all previous cached answers unreachable without needing to scan or delete anything.

Both caches live in the same Redis instance, distinguished by key prefixes. TTL is set per-key, not per-instance — Redis allows each key to have its own independent expiry.

---

## Rate limiting — exactly how the counter works

```js
// key changes at fixed clock-minute boundaries, globally, same for everyone
function currentWindowKey(tenantId) {
  const minuteBucket = Math.floor(Date.now() / 60000);
  return `ratelimit:${tenantId}:${minuteBucket}`;
}

const count = await redis.incr(key);       // atomic — no race condition under concurrent traffic
if (count === 1) redis.expire(key, 60);    // memory cleanup only, NOT the rate-limit boundary
const allowed = count <= 20;               // our code decides, not Redis
```

The window boundary is a fixed clock-minute (`:00` to `:59.999`). The `EXPIRE(60)` is purely so old keys auto-delete from Redis memory — it plays no role in the allow/block decision. Known trade-off: a tenant could send 20 requests at `:59` and 20 at `:00` one second later. A sliding-window or token-bucket algorithm closes this gap at the cost of more Redis operations per request — fixed-window was chosen deliberately for simplicity since the goal is protecting against sustained abuse, not perfectly smoothing millisecond bursts.

---

## Retrieval evaluation

```bash
docker compose exec app npm run eval
```

Ingests a labeled 4-document dataset and runs 8 questions through the real pipeline:

```
Q: "How do I verify a webhook signature?"
   expected: Webhooks Guide
   precision@4: 0.25  |  recall@4: 1.00

Average precision@4: 0.250
Average recall@4:    1.000
```

Recall is perfect — the right document was always retrieved. Precision is 0.25 because TOP_K=4 equals the entire corpus size, so all 4 chunks always return — a corpus-size artifact, not a retrieval failure. Correctly diagnosing that distinction rather than "fixing" something that's working is what an evaluation methodology is for.

---

## Stack

| Layer | Choice |
|---|---|
| API | Express.js + JWT |
| Vector search | ChromaDB (automatic HNSW index) |
| Keyword search | OpenSearch (Lucene BM25, explicit mapping) |
| Embeddings | `all-MiniLM-L6-v2` — local CPU, no API cost |
| LLM | Groq / Llama 3.1 8B — free tier |
| Cache + rate limit | Redis |
| Metadata + usage | MongoDB |
| PDF extraction | pdf-parse |
| URL extraction | html-to-text |
| File uploads | multer (memory storage, 10MB, PDF only) |
| Containers | Docker + Docker Compose |
| Orchestration | Kubernetes manifests in `k8s/` |
| Deployment | AWS EC2 + Caddy (HTTPS via nip.io) |
| Frontend | Next.js + React (separate repo) |

---

## Running locally

```bash
git clone https://github.com/omch-29/RAG-platform.git
cd RAG-platform
cp .env.example .env
# fill in: GROQ_API_KEY and JWT_SECRET
docker compose up --build
```

```bash
curl http://localhost:4000/health
# {"status":"ok"}
```

---

## API endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/signup` | — | Create workspace + first admin |
| POST | `/api/auth/login` | — | Login, returns JWT |
| POST | `/api/auth/invite` | admin | Add teammate to your workspace |
| POST | `/api/ingest` | admin | Ingest pasted text |
| GET | `/api/ingest` | member | List workspace documents |
| POST | `/api/query` | member | Ask a question |
| GET | `/api/query/stream` | member | Same, streamed via SSE |
| GET | `/api/query/usage` | member | Token usage + estimated cost |
| GET | `/health` | — | Liveness check |

---

## Project structure

```
src/
  config/          db.js, redis.js, opensearch.js — connection singletons
  models/          Tenant, User, Document, Usage
  middleware/      auth.js, rateLimit.js, errorHandler.js
  services/        chunking, embedding, vectorStore, keywordSearch,
                   fusion, llm, cache, rateLimit, usage,
                   pdfExtraction, urlExtraction
  controllers/     auth, ingest, query, queryStream
  routes/          auth, ingest, query
eval/              labeled dataset (4 docs, 8 questions)
scripts/           runEval.js — precision/recall evaluation runner
k8s/               Kubernetes manifests (Minikube + EKS deployment guides)
deploy/            EC2 step-by-step deployment guide
public/            stream-test.html (dev SSE test page)
```

---

## Honest limitations

- **Chunking is fixed-size by word count**, not sentence-aware — a sentence can be cut at a chunk boundary.
- **Fixed-window rate limiting** has a known 2x burst at window boundaries.
- **Cost figures are estimates** — Groq doesn't expose billing directly; computed from token counts × configurable price per 1K.
- **Rate limiting is per-tenant, not per-user** — all workspace members share one budget.
