# RAG Platform — Phase 1: Core Pipeline

Multi-tenant RAG API. Phase 1 scope: tenant-isolated ingestion, embedding,
vector storage, semantic retrieval, and grounded generation. No caching,
hybrid search, streaming, or rate limiting yet — those are later phases.

## Stack (all free)
- Express + MongoDB — tenant/user/document metadata, JWT auth
- `@xenova/transformers` — local CPU embeddings (`all-MiniLM-L6-v2`), no API cost
- ChromaDB — vector store, single collection, isolated via `tenantId` metadata filter
- Groq API — LLM generation (free tier)

## Setup

1. Copy the env file and fill in your Groq key:
   ```bash
   cp .env.example .env
   # edit .env -> set GROQ_API_KEY
   ```

2. Start Mongo + Chroma + the app:
   ```bash
   docker compose up --build
   ```

   First run will take a minute longer — the embedding model (~80MB) downloads
   on the first embed call and is cached afterward.

3. Health check:
   ```bash
   curl http://localhost:4000/health
   ```

## Test the full pipeline

**1. Sign up a tenant (creates company + first admin user):**
```bash
curl -X POST http://localhost:4000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{
    "tenantName": "Stripe Docs",
    "slug": "stripe-docs",
    "email": "admin@stripe-docs.com",
    "password": "test1234"
  }'
```
Copy the `token` from the response.

**2. Ingest a document:**
```bash
curl -X POST http://localhost:4000/api/ingest \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN>" \
  -d '{
    "title": "Webhooks Guide",
    "text": "Paste a few paragraphs of real documentation text here..."
  }'
```

**3. Query it:**
```bash
curl -X POST http://localhost:4000/api/query \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN>" \
  -d '{ "question": "How do I verify a webhook signature?" }'
```

**4. Prove tenant isolation:** sign up a second tenant with different slug,
ingest different docs, then query with tenant 2's token — it should never
retrieve tenant 1's chunks. This is the demo to screenshot for your portfolio.

## What's deliberately NOT in Phase 1
- LangChain — pipeline is hand-rolled so every stage (chunking, embedding,
  retrieval, prompt assembly) is visible and modifiable, not hidden behind
  a framework abstraction.
- Caching, hybrid search (BM25), streaming, rate limiting, cost tracking,
  retrieval eval metrics — each is an additive phase on top of this
  working core, built once this loop is proven correct.
