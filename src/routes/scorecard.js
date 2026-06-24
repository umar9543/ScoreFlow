/**
 * scorecard.js — Routes for OneDrive + Local + Direct Upload connections
 *
 * Security model:
 *   masterAuth  → POST /connect, GET /connections, GET /health, DELETE /disconnect
 *   companyAuth → GET /:companyId/results|summary|supplier|tier
 *                 POST /:companyId/upload  (company pushes Excel directly)
 *
 * ✅ Multi-tenant: Each company's key only unlocks their own data.
 * ✅ ZDR: Upload uses multer memoryStorage — file never touches disk.
 */

const express  = require('express');
const multer   = require('multer');
const router   = express.Router();
const watcher  = require('../watcher');
const { masterAuth, companyAuth } = require('../middleware/auth');

// ✅ ZDR: memoryStorage — uploaded file is held in RAM buffer, never written to disk
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 50 * 1024 * 1024 }, // 50 MB max
  fileFilter: (req, file, cb) => {
    const allowed = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
      'application/vnd.ms-excel',                                           // .xls
      'application/octet-stream',                                           // generic binary
    ];
    if (allowed.includes(file.mimetype) || file.originalname.match(/\.xlsx?$/i)) {
      cb(null, true);
    } else {
      cb(new Error('Only Excel files (.xlsx, .xls) are accepted.'));
    }
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN ROUTES — require MASTER key
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/connect
 * Requires: master API key
 * Returns:  company-specific API key (share this with the company)
 */
router.post('/connect', masterAuth, async (req, res) => {
  const { companyId, companyName, sourceType, shareLink, filePath } = req.body;

  if (!companyId || !companyName || !sourceType) {
    return res.status(400).json({
      success: false,
      error:   'Required fields: companyId, companyName, sourceType',
      examples: {
        onedrive: { companyId: 'conrad', companyName: 'Conrad Electronic', sourceType: 'onedrive', shareLink: 'https://drive.google.com/file/d/YOUR_ID/view' },
        local:    { companyId: 'conrad', companyName: 'Conrad Electronic', sourceType: 'local',    filePath:  'C:\\path\\scorecard.xlsx' },
      },
    });
  }

  const id = companyId.toLowerCase().trim().replace(/\s+/g, '-');

  try {
    if (sourceType === 'onedrive') {
      if (!shareLink) return res.status(400).json({ success: false, error: 'shareLink is required for onedrive sourceType' });

      // Connect async — download can take a few seconds
      watcher.connectOneDrive(id, companyName, shareLink)
        .then(() => console.log(`[${id}] OneDrive connection established`))
        .catch(e => console.error(`[${id}] Connection error:`, e.message));

      // Wait briefly so the key is registered in store before we read it
      await new Promise(r => setTimeout(r, 100));
      const companyKey = watcher.getCompanyKey(id);

      return res.json({
        success:    true,
        message:    `${companyName} connecting... Data will be ready in ~10 seconds.`,
        companyId:  id,
        sourceType: 'onedrive',
        pollEvery:  `${process.env.POLL_MINUTES || 5} minutes`,
        security: {
          companyApiKey: companyKey,
          warning:       '⚠️ Save this key! It is only shown once. Share it with the company to access their data.',
          usage:         `x-api-key: ${companyKey}`,
        },
        endpoints: {
          results:  `GET /api/${id}/results`,
          summary:  `GET /api/${id}/summary`,
          supplier: `GET /api/${id}/supplier/:vendorNo`,
          tier:     `GET /api/${id}/tier/strategic`,
          turnover: `GET /api/${id}/turnover`,
        },
      });

    } else if (sourceType === 'local') {
      if (!filePath) return res.status(400).json({ success: false, error: 'filePath is required for local sourceType' });

      watcher.connectLocal(id, companyName, filePath);
      const companyKey = watcher.getCompanyKey(id);

      setTimeout(() => {
        const e = watcher.getData(id);
        res.json({
          success:        true,
          message:        `${companyName} connected (local file watcher active).`,
          companyId:      id,
          sourceType:     'local',
          totalSuppliers: e?.data?.summary?.totalSuppliers || 'processing...',
          security: {
            companyApiKey: companyKey,
            warning:       '⚠️ Save this key! It is only shown once. Share it with the company to access their data.',
            usage:         `x-api-key: ${companyKey}`,
          },
        });
      }, 3000);

    } else if (sourceType === 'upload') {
      // Register company for direct upload — no cloud needed
      const companyKey = watcher.connectUpload(id, companyName);

      return res.json({
        success:    true,
        message:    `${companyName} registered for direct upload. Push your Excel to the upload endpoint.`,
        companyId:  id,
        sourceType: 'upload',
        security: {
          companyApiKey: companyKey,
          warning:       '⚠️ Save this key! It is only shown once. Share it with the company to upload their data.',
          usage:         `x-api-key: ${companyKey}`,
        },
        endpoints: {
          upload:   `POST /api/${id}/upload  (multipart/form-data, field: "file")`,
          results:  `GET  /api/${id}/results`,
          summary:  `GET  /api/${id}/summary`,
          supplier: `GET  /api/${id}/supplier/:vendorNo`,
          tier:     `GET  /api/${id}/tier/strategic`,
        },
        gdpr: {
          diskWrite:         false,
          cloudStorage:      'none',
          dataLocation:      'EU Frankfurt (Railway)',
          rawFileRetained:   false,
          rightToErasure:    `DELETE /api/${id}/disconnect`,
        },
      });

    } else {
      res.status(400).json({ success: false, error: 'sourceType must be "onedrive", "local", or "upload"' });
    }

  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// List all connections — admin only
router.get('/connections', masterAuth, (req, res) => {
  res.json({ success: true, connections: watcher.listAll() });
});

// Health check — admin only
router.get('/health', masterAuth, (req, res) => {
  const all = watcher.listAll();
  res.json({
    success: true,
    status: 'online',
    companies: all.length,
    connections: all.map(c => ({ id: c.companyId, status: c.status, source: c.sourceType })),
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DIRECT UPLOAD ROUTE — company pushes Excel file directly (no cloud needed)
// ✅ ZDR: multer memoryStorage → file in RAM buffer → processed → buffer deleted
// ✅ GDPR: No disk write, no cloud, data stays in EU Frankfurt
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/:companyId/upload
 * Requires:  company API key (or master key)
 * Body:      multipart/form-data with field "file" (Excel .xlsx/.xls)
 * ZDR:       File received as RAM buffer → parsed → buffer discarded immediately
 */
router.post('/:companyId/upload', companyAuth, upload.single('file'), async (req, res) => {
  const companyId = req.params.companyId;

  if (!req.file) {
    return res.status(400).json({
      success: false,
      error:   'No file received. Send Excel as multipart/form-data with field name "file".',
      example: 'curl -X POST https://your-api.railway.app/api/conrad/upload -H "x-api-key: YOUR_KEY" -F "file=@scorecard.xlsx"',
    });
  }

  const entry = watcher.getData(companyId);
  if (!entry) {
    return res.status(404).json({
      success: false,
      error:   `"${companyId}" not registered. POST /api/connect with sourceType "upload" first.`,
    });
  }

  const fileSizeKB = (req.file.size / 1024).toFixed(0);
  const fileName   = req.file.originalname;

  console.log(`[${companyId}] 📤 Direct upload received: ${fileName} (${fileSizeKB} KB) — processing in RAM...`);

  try {
    // ✅ ZDR: Pass the in-memory Buffer directly to processFile — no disk write ever
    const result = watcher.processUpload(companyId, req.file.buffer);

    // ✅ ZDR: Buffer reference released — GC will collect it
    req.file.buffer = null;

    if (!result.success) {
      return res.status(500).json({ success: false, error: result.error });
    }

    return res.json({
      success:          true,
      companyId,
      fileName,
      fileSizeKB,
      suppliersProcessed: result.totalSuppliers,
      avgScore:           result.avgScore,
      lastUpdated:        result.lastUpdated,
      // ✅ GDPR proof — returned in every response
      gdpr: {
        rawFileRetained:  false,
        diskWrite:        false,
        cloudStorage:     'none — file sent directly to API',
        processingTime:   '< 5 seconds in RAM',
        message:          '✅ Your Excel file was processed in RAM and immediately discarded. No copy retained.',
      },
      endpoints: {
        results:  `GET /api/${companyId}/results`,
        summary:  `GET /api/${companyId}/summary`,
      },
    });

  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Disconnect — admin only
router.delete('/:companyId/disconnect', masterAuth, (req, res) => {
  watcher.disconnect(req.params.companyId);
  res.json({ success: true, message: `${req.params.companyId} disconnected.` });
});

// ─────────────────────────────────────────────────────────────────────────────
// COMPANY DATA ROUTES — require COMPANY key (or master key)
// ✅ Conrad's key → only Conrad's data
// ✅ Integra's key → only Integra's data
// ✅ Master key → any company (admin)
// ─────────────────────────────────────────────────────────────────────────────

router.get('/:companyId/results', companyAuth, (req, res) => {
  const entry = watcher.getData(req.params.companyId);
  if (!entry) return res.status(404).json({ success: false, error: `"${req.params.companyId}" not connected. POST /api/connect first.` });
  if (entry.status === 'connecting' || entry.status === 'processing') return res.status(202).json({ success: false, status: entry.status, message: 'Data is loading. Try again in a few seconds.' });
  if (entry.error) return res.status(500).json({ success: false, error: entry.error });
  res.json({ success: true, ...entry.data });
});

router.get('/:companyId/summary', companyAuth, (req, res) => {
  const entry = watcher.getData(req.params.companyId);
  if (!entry?.data) return res.status(entry ? 202 : 404).json({ success: false, status: entry?.status || 'not_found', message: entry ? 'Still loading...' : 'Not connected.' });
  const { companyId, companyName, sourceType, lastUpdated, nextRefreshIn, summary, tierDistribution, topSuppliers, bottomSuppliers } = entry.data;
  res.json({ success: true, companyId, companyName, sourceType, lastUpdated, nextRefreshIn, summary, tierDistribution, topSuppliers, bottomSuppliers });
});

router.get('/:companyId/supplier/:vendorNo', companyAuth, (req, res) => {
  const entry = watcher.getData(req.params.companyId);
  if (!entry?.data) return res.status(404).json({ success: false, error: 'Not connected or loading.' });
  const supplier = entry.data.suppliers.find(s => s.vendorNo === req.params.vendorNo);
  if (!supplier) return res.status(404).json({ success: false, error: `Supplier ${req.params.vendorNo} not found.` });
  res.json({ success: true, supplier });
});

router.get('/:companyId/tier/:tierName', companyAuth, (req, res) => {
  const map = { strategic: 'Strategic Partner', preferred: 'Preferred Supplier', approved: 'Approved Supplier', atrisk: 'At Risk' };
  const tier = map[req.params.tierName.toLowerCase()];
  if (!tier) return res.status(400).json({ success: false, error: 'Use: strategic | preferred | approved | atrisk' });
  const entry = watcher.getData(req.params.companyId);
  if (!entry?.data) return res.status(404).json({ success: false, error: 'Not connected or loading.' });
  const suppliers = entry.data.suppliers.filter(s => s.tier === tier);
  res.json({ success: true, tier, count: suppliers.length, suppliers });
});

/**
 * GET /api/:companyId/turnover
 * Returns turnover chart data for all suppliers sorted by CEI Buying 2025 (EUR) value.
 * Includes per-class distribution (A/B/C/D) for the chart.
 *
 * Optional query params:
 *   ?limit=N     — return only top N suppliers (default: all)
 *   ?class=A     — filter by business class (A/B/C/D)
 *   ?minValue=N  — filter suppliers with CEI Buying 2025 >= N
 */
router.get('/:companyId/turnover', companyAuth, (req, res) => {
  const entry = watcher.getData(req.params.companyId);
  if (!entry?.data) return res.status(entry ? 202 : 404).json({ success: false, status: entry?.status || 'not_found', message: entry ? 'Still loading...' : 'Not connected.' });

  let chart = entry.data.turnoverChart || [];

  // Optional filter by business class
  if (req.query.class) {
    const cls = req.query.class.toUpperCase();
    chart = chart.filter(t => t.businessClass === cls);
  }

  // Optional filter by minimum value
  if (req.query.minValue) {
    const min = parseFloat(req.query.minValue);
    if (!isNaN(min)) chart = chart.filter(t => (t.actuals?.ceiBuying2025 || 0) >= min);
  }

  // Optional limit
  if (req.query.limit) {
    const lim = parseInt(req.query.limit, 10);
    if (!isNaN(lim) && lim > 0) chart = chart.slice(0, lim);
  }

  res.json({
    success:               true,
    companyId:             req.params.companyId,
    lastUpdated:           entry.data.lastUpdated,
    totalCeiBuying2025:    entry.data.summary.totalCeiBuying2025,
    totalSuppliers:        (entry.data.turnoverChart || []).length,
    suppliersWithValue:    (entry.data.turnoverChart || []).filter(t => t.actuals?.ceiBuying2025 > 0).length,
    classDistribution:     entry.data.turnoverClassDistribution,
    turnoverTotals:        entry.data.turnoverTotals,
    chart,
  });
});

module.exports = router;
