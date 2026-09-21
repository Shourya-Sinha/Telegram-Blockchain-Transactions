const connectDB = require('./config/db');
const env = require('./config/env');
const User = require('./models/User');
const Wallet = require('./models/Wallet');
const { ensureSettings } = require('./services/stats');
const { ensureGenesis } = require('./services/chain');
const { encrypt } = require('./utils/crypto');
const { ethers } = require('ethers');

async function seed() {
  await connectDB();
  await ensureSettings();
  await ensureGenesis();

  let admin = await User.findOne({ email: env.SEED_ADMIN_EMAIL.toLowerCase() });
  if (!admin) {
    const passwordHash = await User.hashPassword(env.SEED_ADMIN_PASSWORD);
    admin = await User.create({
      name: 'Admin',
      email: env.SEED_ADMIN_EMAIL.toLowerCase(),
      passwordHash,
      role: 'admin',
      dailyLimit: env.DAILY_SEND_LIMIT,
    });
    console.log('[seed] admin created:', admin.email);
  } else if (admin.role !== 'admin') {
    admin.role = 'admin';
    await admin.save();
    console.log('[seed] promoted to admin:', admin.email);
  } else {
    console.log('[seed] admin exists:', admin.email);
  }

  const hasWallet = await Wallet.findOne({ user: admin._id });
  if (!hasWallet) {
    const w = ethers.Wallet.createRandom();
    await Wallet.create({
      user: admin._id,
      address: w.address.toLowerCase(),
      label: 'Admin treasury',
      encryptedKey: encrypt(w.privateKey),
      balance: 1000000,
    });
    console.log('[seed] admin treasury wallet funded with 1,000,000', env.TOKEN_SYMBOL);
  }
  console.log('[seed] done');
  process.exit(0);
}

seed().catch((e) => {
  console.error('[seed] failed', e);
  process.exit(1);
});
