const mongoose = require('mongoose');

// async function connectDB() {
//   const uri = process.env.MONGO_URI;
//   if (!uri) {
//     throw new Error('MONGO_URI is not set in environment variables');
//   }

//   mongoose.connection.on('connected', () => {
//     console.log('[mongo] connected');
//   });

//   mongoose.connection.on('error', (err) => {
//     console.error('[mongo] connection error:', err.message);
//   });

//   await mongoose.connect(uri);
// }

async function connectDB({ retries = 5, delayMs = 3000 } = {}) {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    throw new Error('MONGO_URI is not set in environment variables');
  }
 
  mongoose.connection.on('connected', () => {
    console.log('[mongo] connected');
  });
 
  mongoose.connection.on('error', (err) => {
    console.error('[mongo] connection error:', err.message);
  });
 
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await mongoose.connect(uri);
      return;
    } catch (err) {
      console.error(`[mongo] connection attempt ${attempt}/${retries} failed: ${err.message}`);
      if (attempt === retries) throw err;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

module.exports = connectDB;