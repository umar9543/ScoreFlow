/**
 * grader.js
 * Assigns A/B/C grades to each KPI for a given supplier.
 * Uses pre-built lookup maps from parser.js.
 */

const MISSING = 'A'; // Default grade when source data not available

/**
 * Grade all 23 KPIs for a single supplier.
 * @param {string} vendorNo
 * @param {object} lookups - from parser.parseWorkbook()
 * @returns {object} grades + dataWarnings
 */
function gradeSupplier(vendorNo, lookups) {
  const warnings = []; // Track which KPIs used default

  function get(map, key, field = null) {
    const entry = map[key];
    if (!entry) return null;
    if (field) return entry[field] || null;
    return entry;
  }

  function grade(val, kpiName) {
    if (val && ['A', 'B', 'C'].includes(String(val).toUpperCase())) {
      return String(val).toUpperCase();
    }
    warnings.push(kpiName);
    return MISSING;
  }

  // ── Assortment & Margin (5 KPIs) ──────────────────────────────────────────
  const ceiBuying  = grade(get(lookups.ceiBuying, vendorNo),           'CEI Buying');
  const ceeRetail  = grade(get(lookups.ceeRetail, vendorNo),           'CEE Retail');
  const ceiProfit  = grade(get(lookups.ceiProfit, vendorNo),           'CEI Profit');
  const ceeCm1     = grade(get(lookups.ceeCm1,    vendorNo),           'CEE CM1');
  const newItem    = grade(get(lookups.newItem,   vendorNo),           'New Item%');

  // ── Quality Assurance (5 KPIs) ─────────────────────────────────────────────
  const passRate   = grade(get(lookups.inspection, vendorNo, 'passRate'),   'Inspection Pass Rate');
  const defectRate = grade(get(lookups.inspection, vendorNo, 'defectRate'), 'Defect Rate');
  const reInspect  = grade(get(lookups.inspection, vendorNo, 'reInspect'),  'Re-inspection');
  const ivi        = grade(null,                                             'IVI');         // no source sheet
  const returnRate = grade(null,                                             'Return Rate'); // no source sheet

  // ── Delivery & Fulfillment (3 KPIs) ────────────────────────────────────────
  const leadTime   = grade(get(lookups.leadtime, vendorNo),  'Lead Time');
  const onTime     = grade(null,                             'On-time Rate'); // no source sheet
  const otif       = grade(null,                             'OTIF');         // no source sheet

  // ── Operation (4 KPIs) — no source sheet, default A ───────────────────────
  const vessel     = grade(null, 'Vessel Booking');
  const inspBook   = grade(null, 'Inspection Booking');
  const orderConf  = grade(null, 'Order Confirmation');
  const comms      = grade(null, 'Communication');

  // ── Terms & Conditions (6 KPIs) ────────────────────────────────────────────
  const payment    = grade(get(lookups.service, vendorNo, 'payment'),   'Payment Terms');
  const fob        = grade(get(lookups.service, vendorNo, 'fob'),       'FOB Terms');
  const remission  = grade(get(lookups.service, vendorNo, 'remission'), 'Remission %');
  const bonus      = grade(get(lookups.service, vendorNo, 'bonus'),     'Agreed Bonus');
  const mov        = grade(get(lookups.service, vendorNo, 'mov'),       'MOV Required');
  const autoBonus  = grade(get(lookups.service, vendorNo, 'autoBonus'), 'Auto Bonus');

  // ── Sustainability (1 KPI) — no source sheet ──────────────────────────────
  const sustainability = grade(null, 'Sustainability');

  return {
    grades: {
      // Assortment & Margin
      ceiBuying, ceeRetail, ceiProfit, ceeCm1, newItem,
      // Quality
      passRate, defectRate, reInspect, ivi, returnRate,
      // Delivery
      leadTime, onTime, otif,
      // Operation
      vessel, inspBook, orderConf, comms,
      // Terms
      payment, fob, remission, bonus, mov, autoBonus,
      // Sustainability
      sustainability,
    },
    dataWarnings: warnings,
  };
}

module.exports = { gradeSupplier };
