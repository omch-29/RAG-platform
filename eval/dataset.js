/**
 * Labeled evaluation dataset for retrieval quality measurement.
 *
 * Each document covers a DISTINCT topic deliberately — this is what
 * makes precision/recall meaningful. If every document covered similar
 * ground, almost any retrieval would score well by accident. Distinct
 * topics mean a correct retrieval has to actually distinguish between
 * them, which is what precision@k and recall@k are measuring.
 *
 * `relevantTitles` is the ground truth: the documents a human (you)
 * judges to be genuinely relevant to that question. This is the part
 * that can't be automated — someone has to decide what "correct" means
 * before you can measure whether the system achieves it.
 */

const documents = [
  {
    title: 'Webhooks Guide',
    text:
      'Webhooks let your application receive real-time notifications when events happen. ' +
      'To verify a webhook signature, compute an HMAC SHA256 hash of the raw request body ' +
      'using your webhook secret, then compare it to the signature sent in the X-Signature ' +
      'header. Webhook events are retried up to 5 times with exponential backoff if your ' +
      'endpoint returns a non-2xx response.',
  },
  {
    title: 'Authentication Guide',
    text:
      'API requests must be authenticated using a Bearer token in the Authorization header. ' +
      'Tokens are JSON Web Tokens (JWT) signed with your account secret and expire after 7 ' +
      'days. To refresh an expired token, call the /auth/refresh endpoint with your refresh ' +
      'token. Never expose your account secret in client-side code.',
  },
  {
    title: 'Rate Limiting Guide',
    text:
      'API requests are limited to 100 requests per minute per API key on the free tier, and ' +
      '1000 requests per minute on the pro tier. When the rate limit is exceeded, the API ' +
      'returns a 429 status code with a Retry-After header indicating how many seconds to ' +
      'wait before retrying.',
  },
  {
    title: 'Pagination Guide',
    text:
      'List endpoints return paginated results using cursor-based pagination. Pass a `limit` ' +
      'parameter to control page size (default 20, max 100), and use the `next_cursor` value ' +
      'from the response to fetch the following page. Cursor-based pagination is used instead ' +
      'of offset-based pagination because it remains stable even when records are added or ' +
      'deleted between requests.',
  },
];

const queries = [
  { question: 'How do I verify a webhook signature?', relevantTitles: ['Webhooks Guide'] },
  { question: 'How many times are webhooks retried?', relevantTitles: ['Webhooks Guide'] },
  { question: 'How do I authenticate API requests?', relevantTitles: ['Authentication Guide'] },
  { question: 'How long until my access token expires?', relevantTitles: ['Authentication Guide'] },
  { question: 'What happens if I exceed the rate limit?', relevantTitles: ['Rate Limiting Guide'] },
  { question: 'What is the rate limit on the free tier?', relevantTitles: ['Rate Limiting Guide'] },
  { question: 'How do I fetch the next page of results?', relevantTitles: ['Pagination Guide'] },
  { question: 'Why does this API use cursor pagination instead of offsets?', relevantTitles: ['Pagination Guide'] },
];

module.exports = { documents, queries };