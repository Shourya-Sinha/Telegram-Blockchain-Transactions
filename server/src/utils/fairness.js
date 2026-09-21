/**
 * Fair mempool ordering.
 *
 * Problem: a naive fee-sorted mempool lets one whale/spammer fill every block.
 * Our policy (documented, deterministic, explainable to users):
 *   1. Cap fee priority: effectiveFee = min(fee, feeCap) so overpaying has bounded advantage.
 *   2. Round-robin across sender addresses: each sender contributes at most
 *      `perUserCap` txs per block, interleaved by earliest-tx-first sender order.
 *   3. Within a sender, FIFO by (nonce, createdAt).
 *
 * This guarantees every active user gets into the next block when
 * (#activeSenders * perUserCap) <= maxPerBlock, and otherwise degrades
 * gracefully to round-robin instead of starvation.
 */
function fairBatch(pendingTxs, { maxPerBlock = 10, perUserCap = 2, feeCap = Infinity } = {}) {
  // Group by sender
  const groups = new Map();
  for (const tx of pendingTxs) {
    const key = (tx.fromAddress || '').toLowerCase();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(tx);
  }
  // Sort each sender FIFO (nonce then createdAt), tie-break by capped fee desc
  for (const list of groups.values()) {
    list.sort((a, b) => {
      if (a.nonce !== b.nonce) return a.nonce - b.nonce;
      const fa = Math.min(a.fee || 0, feeCap);
      const fb = Math.min(b.fee || 0, feeCap);
      if (fa !== fb) return fb - fa;
      return new Date(a.createdAt) - new Date(b.createdAt);
    });
  }
  // Sender order: earliest first-tx first (FIFO across senders)
  const senders = [...groups.entries()].sort(([, a], [, b]) => {
    const ta = new Date(a[0].createdAt).getTime();
    const tb = new Date(b[0].createdAt).getTime();
    return ta - tb;
  });

  const picked = [];
  for (let round = 0; round < perUserCap && picked.length < maxPerBlock; round++) {
    for (const [, list] of senders) {
      if (picked.length >= maxPerBlock) break;
      if (list[round]) picked.push(list[round]);
    }
  }
  const deferred = pendingTxs.filter((t) => !picked.includes(t));
  return { picked, deferred };
}

function fairnessScore(tx, { feeCap = Infinity } = {}) {
  // Informational score shown in explorer: bounded fee + waiting-time boost.
  const feePart = Math.min(tx.fee || 0, feeCap);
  const waitedSec = Math.max(0, (Date.now() - new Date(tx.createdAt).getTime()) / 1000);
  const waitBoost = Math.min(10, waitedSec / 60); // +1 per minute waited, capped
  return Number((feePart + waitBoost).toFixed(4));
}

module.exports = { fairBatch, fairnessScore };
