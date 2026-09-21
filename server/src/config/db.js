const mongoose = require('mongoose');
const env = require('./env');

async function connectDB() {
  mongoose.set('strictQuery', true);
  await mongoose.connect(env.MONGO_URI, { autoIndex: true });
  console.log('[db] connected to', env.MONGO_URI.replace(/\/\/.*@/, '//***@'));
}

module.exports = connectDB;
