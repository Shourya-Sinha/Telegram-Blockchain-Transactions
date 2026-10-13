import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import type { NextFunction, Request, Response } from 'express';
import { asyncHandler } from './asyncHandler';

test('asyncHandler forwards handler rejections to next() instead of dropping them', async () => {
  // Express 4 never awaits async handlers. Without this wrapper a rejected
  // handler becomes an unhandled rejection and Node terminates the process —
  // exactly the "insufficient balance" crash that used to kill the backend.
  const failure = new Error('Insufficient available balance');
  let nextError: unknown;
  const next = (error: unknown) => { nextError = error; };
  const failing = asyncHandler(async () => { throw failure; });
  failing({} as Request, {} as Response, next as NextFunction);
  await new Promise((resolvePromise) => setImmediate(resolvePromise));
  assert.equal(nextError, failure);
});

test('asyncHandler does not call next() when the handler resolves', async () => {
  let nextCalled = false;
  let responseEnded = false;
  const response = { json: () => { responseEnded = true; } } as unknown as Response;
  const succeeding = asyncHandler(async (_req, res) => { res.json({ ok: true }); });
  succeeding({} as Request, response, (() => { nextCalled = true; }) as NextFunction);
  await new Promise((resolvePromise) => setImmediate(resolvePromise));
  assert.equal(nextCalled, false);
  assert.equal(responseEnded, true);
});

test('no route file registers a bare async handler — every one must be wrapped with asyncHandler', () => {
  const routeFiles = ['../routes/userRoutes.ts', '../routes/adminRoutes.ts'];
  for (const file of routeFiles) {
    const source = readFileSync(resolve(process.cwd(), file.replace('../', 'src/')), 'utf8');
    // ", async (" directly after a path/middleware argument means the handler
    // was not wrapped; wrapped handlers read ", asyncHandler(async (".
    const unwrapped = source.match(/,\s*async\s*\(/g);
    assert.equal(unwrapped, null, `${file} contains ${unwrapped ? unwrapped.length : 0} unwrapped async route handler(s)`);
  }
});
