/**
 * Zero-dependency CSV builder with proper RFC4180 escaping.
 * columns: [{ key, label?, get?(row) }]
 */
function esc(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') return esc(JSON.stringify(v));
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCSV(columns, rows) {
  const head = columns.map((c) => esc(c.label || c.key)).join(',');
  const lines = rows.map((r) =>
    columns.map((c) => esc(typeof c.get === 'function' ? c.get(r) : r[c.key])).join(',')
  );
  return [head, ...lines].join('\n') + '\n';
}

function sendCSV(res, filename, columns, rows) {
  const csv = toCSV(columns, rows);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send('﻿' + csv); // BOM for Excel
}

function dateRange(query) {
  const f = {};
  if (query.from || query.to) {
    f.createdAt = {};
    if (query.from) f.createdAt.$gte = new Date(query.from);
    if (query.to) {
      const to = new Date(query.to);
      // include the whole "to" day when only a date is passed
      if (/^\d{4}-\d{2}-\d{2}$/.test(query.to)) to.setHours(23, 59, 59, 999);
      f.createdAt.$lte = to;
    }
  }
  return f;
}

const TX_COLUMNS = [
  { key: 'hash', label: 'hash' },
  { key: 'type', label: 'type' },
  { key: 'status', label: 'status' },
  { key: 'fromAddress', label: 'from' },
  { key: 'toAddress', label: 'to' },
  { key: 'amount', label: 'amount' },
  { key: 'fee', label: 'fee' },
  { key: 'nonce', label: 'nonce' },
  { key: 'blockNumber', label: 'block' },
  { key: 'confirmations', label: 'confirmations' },
  { key: 'note', label: 'note' },
  { key: 'failureReason', label: 'failure_reason' },
  { key: 'evmTxHash', label: 'evm_tx' },
  { key: 'createdAt', label: 'created_at' },
  { key: 'processedAt', label: 'processed_at' },
];

module.exports = { esc, toCSV, sendCSV, dateRange, TX_COLUMNS };
