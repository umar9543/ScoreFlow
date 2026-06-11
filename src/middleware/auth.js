/**
 * auth.js — Multi-Tenant API Key Authentication Middleware
 *
 * Two middleware functions:
 *
 *  1. masterAuth  — requires the MASTER API_KEY (from .env / Railway env var)
 *                   Used for admin routes: POST /api/connect, GET /api/connections
 *
 *  2. companyAuth — requires the COMPANY-SPECIFIC key (generated on connect)
 *                   OR the master key (admin can see everything)
 *                   Used for data routes: GET /api/:companyId/results, etc.
 *
 * ✅ Multi-tenant: Conrad's key can ONLY access Conrad's data.
 *                  Integra's key can ONLY access Integra's data.
 *                  Master key can access ALL companies (admin only).
 */

const watcher = require('../watcher');

// ── Helper: extract key from header or query param ────────────────────────────
function extractKey(req) {
  return req.headers['x-api-key'] || req.query.apiKey || null;
}

// ── 1. Master Auth — only accepts the MASTER key from .env ────────────────────
function masterAuth(req, res, next) {
  const MASTER_KEY = process.env.API_KEY;

  if (!MASTER_KEY) {
    console.error('[security] ❌ API_KEY is not set in environment variables!');
    return res.status(500).json({
      success: false,
      error:   'Server misconfiguration: API_KEY environment variable is not set.',
    });
  }

  const provided = extractKey(req);

  if (!provided) {
    return res.status(401).json({
      success: false,
      error:   'Unauthorized: Missing API key.',
      hint:    'Send your master API key in the request header: x-api-key: <master-key>',
    });
  }

  if (provided !== MASTER_KEY) {
    console.warn(`[security] ⚠️  Invalid master key attempt from IP: ${req.ip}`);
    return res.status(401).json({
      success: false,
      error:   'Unauthorized: Invalid API key.',
    });
  }

  next();
}

// ── 2. Company Auth — accepts COMPANY key (own data only) or MASTER key (admin) ─
function companyAuth(req, res, next) {
  const MASTER_KEY  = process.env.API_KEY;
  const companyId   = req.params.companyId;
  const provided    = extractKey(req);

  if (!provided) {
    return res.status(401).json({
      success: false,
      error:   'Unauthorized: Missing API key.',
      hint:    'Send your company API key in the request header: x-api-key: <your-company-key>',
    });
  }

  // ✅ Admin bypass: master key can access any company
  if (MASTER_KEY && provided === MASTER_KEY) {
    return next();
  }

  // ✅ Company key check: key must match this specific companyId only
  const companyKey = watcher.getCompanyKey(companyId);

  if (!companyKey) {
    // Company not connected yet — let the route handler return 404
    return next();
  }

  if (provided !== companyKey) {
    console.warn(`[security] ⚠️  Key mismatch for "${companyId}" from IP: ${req.ip}`);
    return res.status(401).json({
      success: false,
      error:   `Unauthorized: This API key does not have access to "${companyId}" data.`,
    });
  }

  next();
}

module.exports = { masterAuth, companyAuth };
