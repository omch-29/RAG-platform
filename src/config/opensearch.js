const { Client } = require('@opensearch-project/opensearch');

let client = null;

function getOpenSearchClient() {
  if (!client) {
    client = new Client({
      node: process.env.OPENSEARCH_URL || 'http://localhost:9200',
      ssl: { rejectUnauthorized: false }, // security plugin disabled in dev, no real TLS to verify
    });
  }
  return client;
}

module.exports = { getOpenSearchClient };