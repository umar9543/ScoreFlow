/**
 * parser.js — Zero Data Retention Edition
 *
 * Reads the Supplier Performance Measurement Excel.
 * ✅ ZDR: Accepts either a file path (for local file watcher) OR an
 *         in-memory Buffer (for remote OneDrive/Google Drive downloads).
 *         No temporary files are written to disk.
 */

const XLSX = require('xlsx');

/**
 * Parse the workbook and build lookup maps keyed by vendor number (string).
 *
 * @param {string|Buffer} fileOrBuffer
 *   - If string  → read from local disk path (used by local file watcher)
 *   - If Buffer  → parse directly from memory (ZDR: used for OneDrive/GDrive)
 * @returns {object} lookups - { ceiBuying, ceeRetail, ceiProfit, ceeCm1, newItem, inspection, leadtime, service, results }
 */
function parseWorkbook(fileOrBuffer) {
  let wb;

  if (Buffer.isBuffer(fileOrBuffer)) {
    // ✅ ZDR path: parse directly from in-memory buffer — no disk I/O
    wb = XLSX.read(fileOrBuffer, { type: 'buffer', cellFormula: false, cellHTML: false });
  } else {
    // Local file watcher path: read from disk path as before
    wb = XLSX.readFile(fileOrBuffer, { cellFormula: false, cellHTML: false });
  }

  const lookups = {
    ceiBuying:  buildLookup(wb, 'CEI Buying',  0, 5),   // col A=key, col F(5)=rank
    ceeRetail:  buildRankLookup(wb, 'CEE Retail'),       // cols L-O, col O=rank
    ceiProfit:  buildLookup(wb, 'CEI Profit',  0, 5),   // col A=key, col F(5)=rank
    ceeCm1:     buildRankLookup(wb, 'CEE CM1'),          // cols L-O, col O=rank
    newItem:    buildLookup(wb, 'New Item%',   0, 6),   // col A=key, col G(6)=rank
    inspection: buildInspection(wb),                     // cols A,F,G,H
    leadtime:   buildLookup(wb, 'Leadtime',    0, 4),   // col A=key, col E(4)=rank
    service:    buildService(wb),                        // cols A, L-Q (ranks)
    results:    buildResultsList(wb),                    // Results sheet vendor list
  };

  return lookups;
}

/**
 * Generic lookup: key=col[keyIdx], value=col[valIdx]
 */
function buildLookup(wb, sheetName, keyIdx, valIdx) {
  const ws = wb.Sheets[sheetName];
  if (!ws) return {};

  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  const map = {};

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row[keyIdx] == null) continue;
    const key = String(row[keyIdx]).trim();
    const val = row[valIdx] != null ? String(row[valIdx]).trim() : null;
    if (key && val) map[key] = val;
  }

  return map;
}

/**
 * CEE Retail & CEE CM1: rank data is in columns L-O (index 11-14)
 * Col L = vendor no, Col O = rank
 */
function buildRankLookup(wb, sheetName) {
  const ws = wb.Sheets[sheetName];
  if (!ws) return {};

  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  const map = {};

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row[11] == null) continue; // col L = index 11
    const key = String(row[11]).trim();
    const val = row[14] != null ? String(row[14]).trim() : null; // col O = index 14
    if (key && val) map[key] = val;
  }

  return map;
}

/**
 * Inspection: cols A=vendorNo, F=passRateRank, G=defectRateRank, H=reInspectRank
 */
function buildInspection(wb) {
  const ws = wb.Sheets['Inspection'];
  if (!ws) return {};

  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  const map = {};

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row[0] == null) continue;
    const key = String(row[0]).trim();
    map[key] = {
      passRate:   row[5] != null ? String(row[5]).trim() : null, // col F
      defectRate: row[6] != null ? String(row[6]).trim() : null, // col G
      reInspect:  row[7] != null ? String(row[7]).trim() : null, // col H
    };
  }

  return map;
}

/**
 * Service: col A=vendorNo, cols L-Q (idx 11-16) = grade ranks
 * L=Payment, M=FOB, N=Remission, O=Bonus, P=MOV, Q=AutoBonus
 */
function buildService(wb) {
  const ws = wb.Sheets['Service'];
  if (!ws) return {};

  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  const map = {};

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row[0] == null) continue;
    const key = String(row[0]).trim();
    map[key] = {
      payment:    row[11] != null ? String(row[11]).trim() : null, // col L
      fob:        row[12] != null ? String(row[12]).trim() : null, // col M
      remission:  row[13] != null ? String(row[13]).trim() : null, // col N
      bonus:      row[14] != null ? String(row[14]).trim() : null, // col O
      mov:        row[15] != null ? String(row[15]).trim() : null, // col P
      autoBonus:  row[16] != null ? String(row[16]).trim() : null, // col Q
    };
  }

  return map;
}

/**
 * Results sheet: read vendor list (col A=vendorNo, B=name, C=team)
 * Row 1 = title, Row 2 = headers, Row 3+ = data
 */
function buildResultsList(wb) {
  const ws = wb.Sheets['Results'];
  if (!ws) return [];

  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  const vendors = [];

  for (let i = 2; i < rows.length; i++) { // start row 3 (index 2)
    const row = rows[i];
    if (!row || row[0] == null) break;
    vendors.push({
      vendorNo:   String(row[0]).trim(),
      vendorName: row[1] ? String(row[1]).trim() : '',
      team:       row[2] ? String(row[2]).trim() : '',
    });
  }

  return vendors;
}

module.exports = { parseWorkbook };
