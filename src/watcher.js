/**
 * watcher.js — Zero Data Retention Edition
 *
 * Supports TWO source types:
 *   1. "onedrive"  — polls OneDrive/SharePoint/Google Drive share link every N minutes
 *   2. "local"     — watches local/network file path with chokidar (dev/on-premise)
 *
 * ✅ ZDR (Fully Stateless):
 *   - No Excel files are ever written to disk.
 *   - No connections.json or any configuration file is written.
 *   - Downloaded Excel is held as a Buffer in RAM, parsed, scored, and then
 *     only the computed scorecard JSON is retained in the in-memory store.
 *   - Change detection uses an in-memory MD5 hash (never written to a .hash file).
 *   - On server restart, all connections and data are lost — callers must re-POST /api/connect.
 *
 * Works like Power BI:
 *   - Connect once → auto-refresh when data changes
 *   - Dashboard always serves from memory (instant response)
 */

const fs           = require('fs');
const crypto       = require('crypto');
const chokidar     = require('chokidar');
const { downloadExcel }  = require('./downloader');
const { parseWorkbook }  = require('./engine/parser');
const { gradeSupplier }  = require('./engine/grader');
const { calcScores }     = require('./engine/scorer');

const POLL_INTERVAL_MS = (process.env.POLL_MINUTES || 5) * 60 * 1000; // default 5 min

// ✅ ZDR: Volatile in-memory store only — lost on server restart by design.
// Schema: { companyId: { meta, data, error, status, lastHash, companyKey, timer, watcher } }
const store = {};

/** Generate a cryptographically secure 256-bit company-specific API key */
function generateCompanyKey() {
  return crypto.randomBytes(32).toString('hex');
}

// ── Core: Process Excel → build dashboard data ────────────────────────────────
// Accepts either a local file path (string) or an in-memory Buffer (ZDR).
function processFile(companyId, filePathOrBuffer) {
  const entry = store[companyId];
  if (!entry) return;

  console.log(`[${companyId}] 🔄 Processing Excel...`);
  entry.status = 'processing';

  try {
    const lookups  = parseWorkbook(filePathOrBuffer);
    const vendors  = lookups.results;   // [ { vendorNo, vendorName, team } ]
    if (!vendors || !vendors.length) throw new Error('No suppliers found in Results sheet of Excel.');

    const suppliers = vendors.map((v) => {
      const { grades, dataWarnings }                              = gradeSupplier(v.vendorNo, lookups);
      const { pillars, totalScore, tier,
              businessClass, performance, overallClass,
              actuals }                                          = calcScores(lookups.scoresMap[v.vendorNo] || {});
      return {
        vendorNo:      v.vendorNo,
        vendorName:    v.vendorName,
        team:          v.team,
        tier,
        totalScore,
        pillars,
        grades,
        dataWarnings,
        businessClass,
        performance,
        overallClass,
        actuals,
      };
    });

    suppliers.sort((a, b) => b.totalScore - a.totalScore);

    const total = suppliers.length;
    const summary = {
      totalSuppliers:     total,
      strategicPartners:  suppliers.filter(s => s.tier === 'Strategic Partner').length,
      preferredSuppliers: suppliers.filter(s => s.tier === 'Preferred Supplier').length,
      approvedSuppliers:  suppliers.filter(s => s.tier === 'Approved Supplier').length,
      atRisk:             suppliers.filter(s => s.tier === 'At Risk').length,
      avgScore:           parseFloat((suppliers.reduce((s, x) => s + x.totalScore, 0) / total).toFixed(2)),
      topScore:           suppliers[0]?.totalScore || 0,
      bottomScore:        suppliers[total - 1]?.totalScore || 0,
      totalCeiBuying2025: parseFloat(suppliers.reduce((s, x) => s + (x.actuals?.ceiBuying2025 || 0), 0).toFixed(2)),
    };

    const tierDistribution = [
      { tier: 'Strategic Partner',  count: summary.strategicPartners,  pct: +((summary.strategicPartners  / total * 100).toFixed(1)) },
      { tier: 'Preferred Supplier', count: summary.preferredSuppliers, pct: +((summary.preferredSuppliers / total * 100).toFixed(1)) },
      { tier: 'Approved Supplier',  count: summary.approvedSuppliers,  pct: +((summary.approvedSuppliers  / total * 100).toFixed(1)) },
      { tier: 'At Risk',            count: summary.atRisk,             pct: +((summary.atRisk             / total * 100).toFixed(1)) },
    ];

    // ── Turnover chart data: all suppliers with actuals, sorted by CEI Buying 2025 desc ──
    const turnoverChart = Object.values(lookups.turnoverMap || {})
      .filter(t => t.actuals?.ceiBuying2025 > 0)
      .sort((a, b) => b.actuals.ceiBuying2025 - a.actuals.ceiBuying2025)
      .map(t => ({
        vendorNo:      t.vendorNo,
        vendorName:    t.vendorName,
        team:          t.team,
        turnoverScore: t.turnoverScore,
        businessClass: t.businessClass,
        performance:   t.performance,
        grades:        t.grades,
        kpis:          t.kpis,
        actuals:       t.actuals,
      }));

    // Business class distribution for turnover chart
    const classCount = { A: 0, B: 0, C: 0, D: 0 };
    const classValue = { A: 0, B: 0, C: 0, D: 0 };
    turnoverChart.forEach(t => {
      const cls = t.businessClass || 'D';
      if (classCount[cls] !== undefined) {
        classCount[cls]++;
        classValue[cls] = parseFloat((classValue[cls] + (t.actuals?.ceiBuying2025 || 0)).toFixed(2));
      }
    });
    const turnoverClassDistribution = ['A','B','C','D'].map(cls => ({
      class:         cls,
      count:         classCount[cls],
      totalValue:    classValue[cls],
      totalValueM:   parseFloat((classValue[cls] / 1_000_000).toFixed(3)), // in millions
      pct:           total > 0 ? +((classCount[cls] / total * 100).toFixed(1)) : 0,
    }));

    // ── Grand totals across ALL suppliers for each turnover KPI ────────────────
    const turnoverTotals = {
      // Sum of all suppliers' actual EUR/HKD values
      totalCeiBuying2024: parseFloat(turnoverChart.reduce((s, t) => s + (t.actuals?.ceiBuying2024 || 0), 0).toFixed(2)),
      totalCeiBuying2025: parseFloat(turnoverChart.reduce((s, t) => s + (t.actuals?.ceiBuying2025 || 0), 0).toFixed(2)),
      totalCeeRetail2025: parseFloat(turnoverChart.reduce((s, t) => s + (t.actuals?.ceeRetail2025 || 0), 0).toFixed(2)),
      totalCeiProfit2024: parseFloat(turnoverChart.reduce((s, t) => s + (t.actuals?.ceiProfit2024 || 0), 0).toFixed(2)),
      totalCeiProfit2025: parseFloat(turnoverChart.reduce((s, t) => s + (t.actuals?.ceiProfit2025 || 0), 0).toFixed(2)),
      totalCeeCm12025:    parseFloat(turnoverChart.reduce((s, t) => s + (t.actuals?.ceeCm12025    || 0), 0).toFixed(2)),
      // In Millions (for chart labels)
      totalCeiBuying2024M: parseFloat((turnoverChart.reduce((s, t) => s + (t.actuals?.ceiBuying2024 || 0), 0) / 1_000_000).toFixed(3)),
      totalCeiBuying2025M: parseFloat((turnoverChart.reduce((s, t) => s + (t.actuals?.ceiBuying2025 || 0), 0) / 1_000_000).toFixed(3)),
      totalCeeRetail2025M: parseFloat((turnoverChart.reduce((s, t) => s + (t.actuals?.ceeRetail2025 || 0), 0) / 1_000_000).toFixed(3)),
      totalCeiProfit2024M: parseFloat((turnoverChart.reduce((s, t) => s + (t.actuals?.ceiProfit2024 || 0), 0) / 1_000_000).toFixed(3)),
      totalCeiProfit2025M: parseFloat((turnoverChart.reduce((s, t) => s + (t.actuals?.ceiProfit2025 || 0), 0) / 1_000_000).toFixed(3)),
      totalCeeCm12025M:    parseFloat((turnoverChart.reduce((s, t) => s + (t.actuals?.ceeCm12025    || 0), 0) / 1_000_000).toFixed(3)),
      // YoY growth CEI Buying
      ceiBuyingGrowthPct: (() => {
        const prev = turnoverChart.reduce((s, t) => s + (t.actuals?.ceiBuying2024 || 0), 0);
        const curr = turnoverChart.reduce((s, t) => s + (t.actuals?.ceiBuying2025 || 0), 0);
        if (!prev) return 0;
        return parseFloat(((curr - prev) / prev * 100).toFixed(1));
      })(),
      // Performance breakdown across all suppliers
      performanceDistribution: {
        top:      turnoverChart.filter(t => t.performance === '1.top').length,
        preferred:turnoverChart.filter(t => t.performance === '2.prefered').length,
        under:    turnoverChart.filter(t => t.performance === '3.under').length,
        critical: turnoverChart.filter(t => t.performance === '4.critical').length,
        noData:   turnoverChart.filter(t => !t.performance).length,
      },
    };

    // ✅ ZDR: Only the computed scorecard JSON is kept — not the raw Excel buffer
    entry.data = {
      companyId,
      companyName:               entry.meta.companyName,
      sourceType:                entry.meta.sourceType,
      lastUpdated:               new Date().toISOString(),
      nextRefreshIn:             entry.meta.sourceType === 'onedrive' ? `${process.env.POLL_MINUTES || 5} minutes` : 'on file change',
      summary,
      tierDistribution,
      topSuppliers:              suppliers.slice(0, 10),
      bottomSuppliers:           suppliers.slice(-5).reverse(),
      suppliers,
      turnoverChart,
      turnoverClassDistribution,
      turnoverTotals,
    };

    entry.error  = null;
    entry.status = 'live';
    console.log(`[${companyId}] ✅ ${total} suppliers processed. Avg: ${summary.avgScore}. Turnover chart: ${turnoverChart.length} suppliers.`);

  } catch (err) {
    entry.error  = err.message;
    entry.status = 'error';
    console.error(`[${companyId}] ❌ Error:`, err.message);
  }
}

// ── OneDrive / SharePoint / Google Drive: poll on schedule ───────────────────
async function pollOneDrive(companyId) {
  const entry = store[companyId];
  if (!entry) return;

  try {
    // ✅ ZDR: Pass in-memory lastHash for change detection — no .hash file read from disk
    const { buffer, hash, changed } = await downloadExcel(
      companyId,
      entry.meta.shareLink,
      entry.lastHash || null    // in-memory hash from previous poll
    );

    if (changed || !entry.data) {
      // ✅ ZDR: Pass Buffer directly to parser — no intermediate disk write
      processFile(companyId, buffer);
      // Store the new hash in memory only
      entry.lastHash = hash;
    }

    entry.meta.lastPolled = new Date().toISOString();
  } catch (err) {
    entry.error  = err.message;
    entry.status = 'error';
    console.error(`[${companyId}] ❌ Poll failed:`, err.message);
  }
}

// ── Local / Network file: watch with chokidar ─────────────────────────────────
// (Local mode still reads from disk path — only remote mode is affected by ZDR)
function watchLocalFile(companyId, filePath) {
  const w = chokidar.watch(filePath, {
    persistent: true, ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 500 },
  });
  w.on('change', () => {
    console.log(`[${companyId}] 📝 File changed on disk. Auto-refreshing...`);
    processFile(companyId, filePath); // Local file: pass path as before
  });
  w.on('unlink', () => {
    store[companyId].error  = 'File was deleted from disk.';
    store[companyId].status = 'error';
  });
  return w;
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Connect via OneDrive / SharePoint / Google Drive share link.
 * ✅ ZDR: No disk writes — connection meta and data held in RAM only.
 */
async function connectOneDrive(companyId, companyName, shareLink) {
  _cleanup(companyId);

  // ✅ Per-company key: unique 256-bit key generated for this company only
  const companyKey = generateCompanyKey();

  store[companyId] = {
    meta:       { companyId, companyName, sourceType: 'onedrive', shareLink, connectedAt: new Date().toISOString(), lastPolled: null },
    data:       null,
    error:      null,
    status:     'connecting',
    lastHash:   null,       // ✅ ZDR: hash lives here in memory, not on disk
    companyKey,             // ✅ Per-company API key — stored in RAM only
    timer:      null,
    watcher:    null,
  };

  // Initial download + process
  await pollOneDrive(companyId);

  // Schedule polling every N minutes
  const timer = setInterval(() => pollOneDrive(companyId), POLL_INTERVAL_MS);
  store[companyId].timer = timer;

  console.log(`[${companyId}] ⏰ Polling every ${process.env.POLL_MINUTES || 5} min (ZDR: no disk writes)`);

  // ✅ ZDR: No saveConnections() call — no disk write
  return store[companyId];
}

/**
 * Register a company for direct Excel upload (no cloud storage needed).
 * ✅ ZDR: No disk writes — connection meta held in RAM only.
 * ✅ GDPR: No third-party cloud — client pushes file directly to API.
 */
function connectUpload(companyId, companyName) {
  _cleanup(companyId);

  const companyKey = generateCompanyKey();

  store[companyId] = {
    meta:       { companyId, companyName, sourceType: 'upload', connectedAt: new Date().toISOString(), lastUploaded: null },
    data:       null,
    error:      null,
    status:     'waiting', // waiting for client to push their first file
    lastHash:   null,
    companyKey,
    timer:      null,
    watcher:    null,
  };

  console.log(`[${companyId}] ✅ Registered for direct upload. Awaiting Excel push...`);

  // ✅ ZDR: No saveConnections() — no disk write
  return companyKey;
}

/**
 * Process a directly uploaded Excel Buffer (from multer memoryStorage).
 * Called by POST /api/:companyId/upload route.
 * ✅ ZDR: Buffer passed in RAM — never written to disk.
 * ✅ GDPR: Raw buffer reference nulled after processing — GC reclaims it.
 *
 * @param {string} companyId
 * @param {Buffer} buffer — Excel file buffer from multer (RAM only)
 * @returns {{ success, totalSuppliers, avgScore, lastUpdated } | { success, error }}
 */
function processUpload(companyId, buffer) {
  const entry = store[companyId];
  if (!entry) return { success: false, error: `${companyId} not registered.` };

  try {
    entry.status = 'processing';
    entry.meta.lastUploaded = new Date().toISOString();

    // ✅ ZDR: processFile accepts Buffer directly — no disk write
    processFile(companyId, buffer);

    if (entry.status === 'error') {
      return { success: false, error: entry.error };
    }

    return {
      success:        true,
      totalSuppliers: entry.data?.summary?.totalSuppliers || 0,
      avgScore:       entry.data?.summary?.avgScore       || 0,
      lastUpdated:    entry.data?.lastUpdated             || new Date().toISOString(),
    };

  } catch (err) {
    entry.status = 'error';
    entry.error  = err.message;
    return { success: false, error: err.message };
  }
}


function connectLocal(companyId, companyName, filePath) {
  _cleanup(companyId);

  if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);

  // ✅ Per-company key: unique 256-bit key generated for this company only
  const companyKey = generateCompanyKey();

  store[companyId] = {
    meta:       { companyId, companyName, sourceType: 'local', filePath, connectedAt: new Date().toISOString() },
    data:       null,
    error:      null,
    status:     'connecting',
    lastHash:   null,
    companyKey,             // ✅ Per-company API key — stored in RAM only
    timer:      null,
    watcher:    null,
  };

  processFile(companyId, filePath);
  store[companyId].watcher = watchLocalFile(companyId, filePath);

  // ✅ ZDR: No saveConnections() call — no disk write
  return store[companyId];
}

function getData(companyId)     { return store[companyId] || null; }
function getCompanyKey(companyId) { return store[companyId]?.companyKey || null; }
function listAll()              { return Object.values(store).map(_summary); }

function _summary(e) {
  return {
    companyId:   e.meta.companyId,
    companyName: e.meta.companyName,
    sourceType:  e.meta.sourceType,
    shareLink:   e.meta.shareLink   || null,
    filePath:    e.meta.filePath    || null,
    connectedAt: e.meta.connectedAt,
    lastUpdated: e.data?.lastUpdated || null,
    lastPolled:  e.meta.lastPolled   || null,
    status:      e.status,
    suppliers:   e.data?.summary?.totalSuppliers || 0,
    error:       e.error || null,
  };
}

function _cleanup(companyId) {
  const e = store[companyId];
  if (!e) return;
  if (e.timer)   clearInterval(e.timer);
  if (e.watcher) e.watcher.close();
  delete store[companyId];
}

function disconnect(companyId) {
  _cleanup(companyId);
  // ✅ ZDR: No saveConnections() — nothing persisted to disk
  console.log(`[${companyId}] 🔌 Disconnected. All data purged from memory.`);
}

module.exports = { connectOneDrive, connectLocal, connectUpload, processUpload, getData, getCompanyKey, listAll, disconnect };
