'use strict';

/**
 * r2Client.js — minimal S3 SigV4 client for WRITING to the Cloudflare R2 bucket
 * (PUT/DELETE only). Reads stay on the public ASSET_BASE_URL; this exists so the
 * bot can publish rendered canvases once and then serve them by URL with zero
 * Discord-upload egress. No SDK dependency — R2 is S3-compatible and the two
 * operations we need sign in ~60 lines of node:crypto.
 *
 * Env (all four required, otherwise isConfigured() is false and callers fall
 * back to attaching): R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
 * R2_BUCKET (must be the bucket ASSET_BASE_URL serves).
 */

const crypto = require('crypto');
const { recordR2Upload, recordR2Delete } = require('./networkTelemetry');

const REQUEST_TIMEOUT_MS = 15_000;
const SAFE_KEY = /^[A-Za-z0-9._/-]+$/; // object keys we generate; no escaping needed

const sha256hex = (data) => crypto.createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();

function env(name) {
  return String(process.env[name] || '').trim();
}

function isConfigured() {
  return Boolean(env('R2_ACCOUNT_ID') && env('R2_ACCESS_KEY_ID') && env('R2_SECRET_ACCESS_KEY') && env('R2_BUCKET'));
}

/** Signed S3 request against R2. Returns the fetch Response. Throws on config/network errors. */
async function r2Request(method, key, body = null, contentType = null) {
  if (!isConfigured()) throw new Error('R2 write credentials are not configured');
  if (!SAFE_KEY.test(key)) throw new Error(`unsafe R2 object key: ${key}`);

  const host = `${env('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`;
  const uri = `/${env('R2_BUCKET')}/${key}`;
  const amzDate = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256hex(body || '');

  const headers = { host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  if (contentType) headers['content-type'] = contentType;
  const signedNames = Object.keys(headers).sort();
  const canonicalHeaders = signedNames.map((h) => `${h}:${headers[h]}\n`).join('');
  const signedHeaders = signedNames.join(';');

  const canonicalRequest = [method, uri, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${dateStamp}/auto/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonicalRequest)].join('\n');
  const kSigning = hmac(hmac(hmac(hmac(`AWS4${env('R2_SECRET_ACCESS_KEY')}`, dateStamp), 'auto'), 's3'), 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  const requestHeaders = {
    ...headers,
    authorization:
      `AWS4-HMAC-SHA256 Credential=${env('R2_ACCESS_KEY_ID')}/${scope}, `
      + `SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
  delete requestHeaders.host; // fetch sets Host itself; it stays in the signature

  return fetch(`https://${host}${uri}`, {
    method,
    headers: requestHeaders,
    body: body || undefined,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

async function cancelResponseBody(response) {
  try {
    const cancellation = response?.body?.cancel?.();
    if (cancellation && typeof cancellation.then === 'function') await cancellation;
  } catch {
    // R2 PUT/DELETE response bodies are not consumed; ignore absent/locked bodies.
  }
}

/** PUT an object. Returns true on success, false otherwise (never throws). */
async function putObject(key, buffer, contentType, logContext = {}) {
  const bytes = Buffer.isBuffer(buffer) || buffer instanceof Uint8Array ? buffer.byteLength : 0;
  let res = null;
  try {
    res = await r2Request('PUT', key, buffer, contentType);
    recordR2Upload(logContext, bytes, res.ok);
    if (!res.ok) console.warn(`[r2Client] PUT ${key} → ${res.status}`);
    return res.ok;
  } catch (err) {
    recordR2Upload(logContext, bytes, false);
    console.warn(`[r2Client] PUT ${key} failed:`, err.message);
    return false;
  } finally {
    await cancelResponseBody(res);
  }
}

/** DELETE an object. Returns true on success or already-gone (never throws). */
async function deleteObject(key, logContext = {}) {
  let res = null;
  try {
    res = await r2Request('DELETE', key);
    const ok = res.ok || res.status === 404;
    recordR2Delete(logContext, ok);
    return ok;
  } catch (err) {
    recordR2Delete(logContext, false);
    console.warn(`[r2Client] DELETE ${key} failed:`, err.message);
    return false;
  } finally {
    await cancelResponseBody(res);
  }
}

module.exports = { isConfigured, putObject, deleteObject };
