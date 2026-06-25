const Redis = require('ioredis');

let client = null;

function getRedisClient() {
  if (!client) {
    const url = process.env.REDIS_URL || 'redis://localhost:6379';
    client = new Redis(url);

    client.on('connect', () => console.log('[redis] connected'));
    client.on('error', (err) => console.error('[redis] error:', err.message));
  }
  return client;
}

module.exports = { getRedisClient };