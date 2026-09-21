const { ethers } = require('ethers');
const env = require('../config/env');
const { getSettings } = require('./stats');

/**
 * SEPOLIA TESTNET ANCHORING
 *
 * Every mined TBT block can be "anchored" to Sepolia: we send a 0-value tx
 * whose data embeds `block number | block hash | tx root | timestamp`.
 * Anyone can verify on Etherscan that a TBT block existed at that time —
 * cheap Proof-of-Existence that upgrades our embedded ledger with real
 * Ethereum finality, without moving any real funds.
 *
 * Modes (Admin → Settings → evmAnchorMode, or EVM_ANCHOR_MODE):
 *   off  — default, no-op (works with zero config)
 *   post — anchor every block (needs EVM_RPC_URL + EVM_SETTLEMENT_KEY)
 *
 * Mining NEVER waits for Sepolia: anchoring runs async with a retry worker.
 */
const SEPOLIA_EXPLORER = 'https://sepolia.etherscan.io';

let provider = null;
let signer = null;
let signerAddress = null;
let chainId = null;
let lastError = null;

function isConfigured() {
  return Boolean(env.EVM_RPC_URL && env.EVM_SETTLEMENT_KEY);
}

async function ensureProvider() {
  if (provider && signer) return true;
  if (!isConfigured()) throw new Error('EVM not configured (set EVM_RPC_URL + EVM_SETTLEMENT_KEY)');
  provider = new ethers.JsonRpcProvider(env.EVM_RPC_URL);
  signer = new ethers.Wallet(env.EVM_SETTLEMENT_KEY, provider);
  signerAddress = await signer.getAddress();
  const net = await provider.getNetwork();
  chainId = Number(net.chainId);
  return true;
}

function resetProvider() {
  provider = null;
  signer = null;
  signerAddress = null;
  chainId = null;
}

function anchorPayload(block) {
  const txRoot = ethers.keccak256(ethers.toUtf8Bytes((block.txs || []).join(',')));
  const text =
    `TBT-ANCHOR v1 | block ${block.number} | hash ${block.hash} ` +
    `| txs ${block.txCount} | root ${txRoot} | ts ${new Date(block.timestamp).toISOString()}`;
  return { text, txRoot };
}

async function markAnchor(blockNumber, patch, incAttempt = true) {
  const Block = require('../models/Block');
  const $set = {};
  for (const [k, v] of Object.entries(patch)) $set[`anchor.${k}`] = v;
  const update = { $set };
  if (incAttempt) update.$inc = { 'anchor.attempts': 1 };
  await Block.updateOne({ number: blockNumber }, update);
}

async function anchorBlock(blockDoc) {
  const s = await getSettings();
  const mode = s.evmAnchorMode || 'off';
  if (mode === 'off') return { skipped: true };

  try {
    await ensureProvider();
    const { text } = anchorPayload(blockDoc);
    const to =
      s.evmAnchorAddress && /^0x[0-9a-fA-F]{40}$/.test(s.evmAnchorAddress)
        ? s.evmAnchorAddress
        : signerAddress;

    const tx = await signer.sendTransaction({
      to,
      value: 0n,
      data: ethers.hexlify(ethers.toUtf8Bytes(text)),
    });

    await markAnchor(blockDoc.number, {
      status: 'submitted',
      evmTxHash: tx.hash,
      evmChainId: chainId,
      evmTo: to,
      lastError: null,
    });
    console.log(`[anchor] block #${blockDoc.number} → Sepolia ${tx.hash}`);

    // Confirm in background — never blocks the miner
    tx.wait(1).then(
      async (rcpt) => {
        const ok = rcpt && Number(rcpt.status) === 1;
        await markAnchor(blockDoc.number, { status: ok ? 'confirmed' : 'failed', confirmedAt: new Date() }, false);
        const { emitPublic } = require('../realtime/socket');
        emitPublic('anchor:confirmed', { block: blockDoc.number, evmTxHash: tx.hash, chainId });
      },
      async (e) => {
        await markAnchor(blockDoc.number, { status: 'failed', lastError: e.message }, false);
      }
    );

    return { ok: true, hash: tx.hash };
  } catch (e) {
    lastError = e.message;
    console.warn(`[anchor] block #${blockDoc.number} failed:`, e.message);
    try {
      await markAnchor(blockDoc.number, { status: 'failed', lastError: e.message });
    } catch (_) {
      /* ignore */
    }
    return { ok: false, error: e.message };
  }
}

/**
 * Background worker: re-check `submitted` receipts, resubmit `failed` (max 10 tries).
 */
async function retryPendingAnchors(limit = 5) {
  const s = await getSettings();
  if ((s.evmAnchorMode || 'off') === 'off') return { skipped: true };
  const Block = require('../models/Block');
  const pending = await Block.find({
    'anchor.status': { $in: ['failed', 'submitted'] },
    'anchor.attempts': { $lt: 10 },
  })
    .sort({ number: 1 })
    .limit(limit);

  const out = [];
  for (const b of pending) {
    // Submitted with a hash → just check the receipt, don't resubmit
    if (b.anchor.status === 'submitted' && b.anchor.evmTxHash) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await ensureProvider();
        // eslint-disable-next-line no-await-in-loop
        const rcpt = await provider.getTransactionReceipt(b.anchor.evmTxHash);
        if (rcpt) {
          const ok = Number(rcpt.status) === 1;
          // eslint-disable-next-line no-await-in-loop
          await markAnchor(b.number, { status: ok ? 'confirmed' : 'failed', confirmedAt: new Date() }, false);
          out.push({ block: b.number, status: ok ? 'confirmed' : 'failed' });
        } else {
          out.push({ block: b.number, status: 'still-pending' });
        }
      } catch (e) {
        out.push({ block: b.number, status: 'receipt-check-failed', error: e.message });
      }
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    const r = await anchorBlock(b);
    out.push({ block: b.number, ...r });
  }
  return { retried: out };
}

async function evmStatus() {
  const s = await getSettings();
  const base = {
    configured: isConfigured(),
    mode: s.evmAnchorMode || 'off',
    chainId,
    signerAddress,
    anchorAddress: s.evmAnchorAddress || null,
    lastError,
    explorer: SEPOLIA_EXPLORER,
    expectedChainId: env.EVM_CHAIN_ID,
  };
  if (!isConfigured()) return { ...base, balance: null };
  try {
    await ensureProvider();
    const bal = await provider.getBalance(signerAddress);
    return { ...base, balance: ethers.formatEther(bal), chainId };
  } catch (e) {
    lastError = e.message;
    return { ...base, balance: null, lastError };
  }
}

module.exports = {
  anchorBlock,
  retryPendingAnchors,
  evmStatus,
  isConfigured,
  anchorPayload,
  resetProvider,
  SEPOLIA_EXPLORER,
};
