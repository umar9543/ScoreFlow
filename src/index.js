/**
 * index.js — Scorecard API (Zero Data Retention + Secured)
 *
 * Security layers:
 *   1. Helmet      — HTTP security headers (XSS, clickjacking, MIME sniffing protection)
 *   2. Rate Limit  — Max 100 requests / 15 min per IP (brute-force protection)
 *   3. API Key     — All /api/* routes require x-api-key header
 *
 * ZDR:
 *   No Excel files, hash files, or connections are ever written to disk.
 *   All data lives exclusively in RAM.
 */

require('dotenv').config();
const express   = require('express');
const cors      = require('cors');
const helmet    = require('helmet');
const rateLimit = require('express-rate-limit');

const app  = express();
const PORT = process.env.PORT || 5000;

// ── 1. CORS — must be FIRST, before Helmet ────────────────────────────────────
// Explicitly allow x-api-key header so browser preflight (OPTIONS) passes.
const corsOptions = {
  origin:         '*',                           // allow all origins (Vercel, localhost, etc.)
  methods:        ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-api-key'], // ✅ must explicitly list x-api-key
  credentials:    false,
};
app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));            // handle preflight OPTIONS for all routes (Express v5 regex syntax)

// ── 2. Helmet — Security headers ─────────────────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }, // allow cross-origin resource sharing
}));

// ── 3. Body parser ────────────────────────────────────────────────────────────
app.use(express.json());

// ── 4. Rate Limiting — 100 requests per 15 minutes per IP ──────────────────
const limiter = rateLimit({
  windowMs:         15 * 60 * 1000, // 15 minutes
  max:              100,             // max requests per window per IP
  standardHeaders:  true,
  legacyHeaders:    false,
  message: {
    success: false,
    error:   'Too many requests. Please wait 15 minutes before trying again.',
  },
});
app.use(limiter);

// ── 5. Public route — no auth required (Railway health check / info) ──────────
app.get('/', (req, res) => {
  res.json({
    name:    'Supplier Scorecard API — Zero Data Retention + Secured',
    version: '5.0.0',
    status:  'running',
    security: {
      masterKey:   '✅ Required for admin routes (POST /api/connect, GET /api/connections)',
      companyKey:  '✅ Required for data routes (GET /api/:companyId/*) — each company gets their own key',
      rateLimit:   '✅ 100 requests per 15 minutes per IP',
      helmet:      '✅ HTTP security headers enabled',
      zdr:         '✅ No Excel files or hashes written to disk — all data in RAM',
      multiTenant: '✅ Conrad\'s key cannot access Integra\'s data and vice versa',
    },
    usage: {
      header:   'x-api-key: YOUR_API_KEY',
      connect:  'POST /api/connect',
      results:  'GET  /api/:companyId/results',
      turnover: 'GET  /api/:companyId/turnover  — chart data sorted by CEI Buying 2025 (EUR)',
    },
    schema: {
      pillars: '4 pillars: Turnover & Margin (30%), Assortment & Innovation (30%), Quality (25%), Fulfillment (15%)',
      grades:  'Numeric KPIs 0-3 mapped to A/B/C/D',
      businessClass: 'A/B/C/D from Excel Results sheet',
      performance:   '1.top / 2.prefered / 3.under / 4.critical from Excel',
    },
  });
});

// ── 6. API routes — auth applied per-route inside scorecard.js ───────────────
app.use('/api', require('./routes/scorecard'));

// ── 7. Error handlers ─────────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ success: false, error: `${req.method} ${req.path} not found` }));
app.use((err, req, res, next) => res.status(500).json({ success: false, error: err.message }));

// ✅ ZDR: No restoreConnections() — fully stateless on startup

app.listen(PORT, () => {
  console.log('');
  console.log(`  ✅ Scorecard API v4.1 — ZDR + Secured`);
  console.log(`  🌐 Running at http://localhost:${PORT}`);
  console.log('');
  console.log('  🔒 Security:');
  console.log('     • API Key auth   → x-api-key header required on all /api/* routes');
  console.log(`     • Rate limiting  → 100 requests / 15 min per IP`);
  console.log('     • Helmet headers → XSS, clickjacking, MIME protection enabled');
  console.log('');
  console.log('  💾 ZDR Guarantees:');
  console.log('     • No Excel files written to disk');
  console.log('     • No hash files written to disk');
  console.log('     • No connections.json written to disk');
  console.log('     • All data held in RAM — purged on server restart');
  console.log('');
  if (!process.env.API_KEY) {
    console.warn('  ⚠️  WARNING: API_KEY is not set in .env — all /api/* requests will return 500!');
    console.warn('     Add API_KEY=your-secret-key to your .env file');
  } else {
    console.log('  🔑 API Key: configured ✅');
  }
  console.log('');
});
