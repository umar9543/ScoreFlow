/**
 * scorecard.js — Routes for OneDrive + Local connections
 *
 * Security model:
 *   masterAuth  → POST /connect, GET /connections, GET /health, DELETE /disconnect
 *   companyAuth → GET /:companyId/results|summary|supplier|tier
 *
 * ✅ Multi-tenant: Each company's key only unlocks their own data.
 */

const express  = require('express');
const router   = express.Router();
const watcher  = require('../watcher');
const { masterAuth, companyAuth } = require('../middleware/auth');

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

    } else {
      res.status(400).json({ success: false, error: 'sourceType must be "onedrive" or "local"' });
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

module.exports = router;
