const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth.routes');
const ingestRoutes = require('./routes/ingest.routes');
const queryRoutes = require('./routes/query.routes');
const errorHandler = require('./middleware/errorHandler');

const app = express();

app.use(cors());
app.use(express.json({ limit: '5mb' })); // raised limit since ingest bodies carry full document text
app.use(express.static('public'));

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/auth', authRoutes);
app.use('/api/ingest', ingestRoutes);
app.use('/api/query', queryRoutes);

app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use(errorHandler);

module.exports = app;