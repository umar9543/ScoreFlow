/**
 * parser.js — Zero Data Retention Edition
 *
 * Reads the Supplier Performance Measurement Excel.
 * ✅ ZDR: Accepts either a file path (for local file watcher) OR an
 *         in-memory Buffer (for remote OneDrive/Google Drive downloads).
 *         No temporary files are written to disk.
 *
 * Results sheet column layout (Row 1 = group headers, Row 2 = KPI headers, Row 3+ = data):
 *   [0]  Vendor No.
 *   [1]  Vendor Name
 *   [2]  Team
 *   ── Assortment & Margin ──
 *   [3]  2025 CEI Buying          grade
 *   [4]  2025 CEE Retail          grade
 *   [5]  2025 CEI Margin/Profit   grade
 *   [6]  2025 CEE CM1             grade
 *   [7]  2025 New item%           grade
 *   ── Quality Assurance ──
 *   [8]  Inspection Pass Rate     grade
 *   [9]  Inspection Defect Rate   grade
 *   [10] Number of Re-inspection  grade
 *   [11] IVI                      grade
 *   [12] Return Rate              grade
 *   ── Delivery & Fulfillment ──
 *   [13] Production Lead time     grade
 *   [14] On-time rate             grade
 *   [15] OTIF                     grade
 *   ── Operation ──
 *   [16] Vessel booking           grade
 *   [17] Inspection booking       grade
 *   [18] Order confirmation       grade
 *   [19] Communication            grade
 *   ── Terms & Conditions ──
 *   [20] Payment Terms            grade
 *   [21] FOB terms                grade
 *   [22] Service remission %      grade
 *   [23] Agreed bonus %           grade
 *   [24] MOV required?            grade
 *   [25] Automated Bonus          grade
 *   ── Sustainability ──
 *   [26] Sustainability (AA)      grade
 *   ── Pre-computed Pillar Scores ──  (used directly — single source of truth)
 *   [29] Assortment & Margin score
 *   [30] Quality Assurance score
 *   [31] Delivery & Fulfillment score
 *   [32] Operation score
 *   [33] Terms & Conditions score
 *   [34] Sustainability score
 *   [35] Total Marks
 */

const XLSX = require('xlsx');

/**
 * Parse the workbook and build lookup maps keyed by vendor number.
 *
 * @param {string|Buffer} fileOrBuffer
 *   - If string  → read from local disk path (used by local file watcher)
 *   - If Buffer  → parse directly from memory (ZDR: used for OneDrive/GDrive)
 * @returns {object} { gradesMap, scoresMap, results }
 *   gradesMap : { [vendorNo]: { ceiBuying, ceeRetail, ... } }  — all KPI letter grades
 *   scoresMap : { [vendorNo]: { assortment, quality, delivery, operation, terms, sustainability, total } }
 *   results   : [ { vendorNo, vendorName, team } ] — ordered vendor list
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

  return buildFromResults(wb);
}

/**
 * Build all data from the Results sheet.
 *
 * Row 1 (index 0) = group headers  (Assortment & Margin, Quality Assurance…)
 * Row 2 (index 1) = KPI headers    (Vendor No., CEI Buying…)
 * Row 3+ (index 2+) = supplier data
 *
 * Grade columns [3]–[26]: A/B/C letter grades per KPI.
 * Score columns [29]–[35]: pre-computed pillar scores from Excel formulas.
 *   We read these directly — avoids replicating the Excel formula logic.
 */
function buildFromResults(wb) {
  const ws = wb.Sheets['Results'];
  if (!ws) return { gradesMap: {}, scoresMap: {}, results: [] };

  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

  const gradesMap = {};
  const scoresMap = {};
  const results   = [];

  // Row index 2 onwards = data (row 1 = group labels, row 2 = KPI headers)
  for (let i = 2; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row[0] == null) break; // empty row = end of data

    const vendorNo = String(row[0]).trim();
    if (!vendorNo) continue;

    // Helper: safely extract a grade cell (A/B/C or null)
    const g = (col) => (row[col] != null ? String(row[col]).trim() : null);

    // Helper: safely extract a numeric score cell
    const n = (col, dp = 2) => {
      const v = row[col];
      if (v == null || isNaN(Number(v))) return 0;
      return parseFloat(Number(v).toFixed(dp));
    };

    // ── Grade columns (3–26) ────────────────────────────────────────────────
    gradesMap[vendorNo] = {
      // Assortment & Margin
      ceiBuying:      g(3),
      ceeRetail:      g(4),
      ceiProfit:      g(5),
      ceeCm1:         g(6),
      newItem:        g(7),
      // Quality Assurance
      passRate:       g(8),
      defectRate:     g(9),
      reInspect:      g(10),
      ivi:            g(11),
      returnRate:     g(12),
      // Delivery & Fulfillment
      leadTime:       g(13),
      onTime:         g(14),
      otif:           g(15),
      // Operation
      vessel:         g(16),
      inspBook:       g(17),
      orderConf:      g(18),
      comms:          g(19),
      // Terms & Conditions
      payment:        g(20),
      fob:            g(21),
      remission:      g(22),
      bonus:          g(23),
      mov:            g(24),
      autoBonus:      g(25),
      // Sustainability
      sustainability: g(26),
    };

    // ── Pre-computed pillar scores from Excel (cols 29–35) ──────────────────
    // These are read directly from the spreadsheet to ensure 100% formula parity.
    const assortment    = n(29, 2);
    const quality       = n(30, 2);
    const delivery      = n(31, 2);
    const operation     = n(32, 2);
    const terms         = n(33, 2);
    const sustainability = n(34, 2);
    const total         = n(35, 2);

    scoresMap[vendorNo] = { assortment, quality, delivery, operation, terms, sustainability, total };

    results.push({
      vendorNo,
      vendorName: row[1] ? String(row[1]).trim() : '',
      team:       row[2] ? String(row[2]).trim() : '',
    });
  }

  return { gradesMap, scoresMap, results };
}

module.exports = { parseWorkbook };
