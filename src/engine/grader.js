/**
 * grader.js
 * Assigns A/B/C grades to each KPI for a given supplier.
 * Reads pre-calculated grades directly from the Results sheet via parser.js.
 *
 * The Results sheet is the single source of truth — all 24 KPIs (including
 * IVI, Return Rate, On-time Rate, OTIF, Vessel, Inspection Booking,
 * Order Confirmation, Communication, Sustainability) are already graded there.
 */

const VALID_GRADES = new Set(['A', 'B', 'C']);

/**
 * Grade all 24 KPIs for a single supplier.
 *
 * @param {string} vendorNo
 * @param {object} lookups - from parser.parseWorkbook() — must contain { gradesMap }
 * @returns {{ grades: object, dataWarnings: string[] }}
 */
function gradeSupplier(vendorNo, lookups) {
  const warnings  = [];
  const rawGrades = lookups.gradesMap?.[vendorNo] || {};

  /**
   * Validate a raw cell value as A/B/C.
   * If missing or invalid → warn + return null (scorer will treat as no data).
   */
  function grade(rawVal, kpiLabel) {
    const v = rawVal != null ? String(rawVal).toUpperCase().trim() : null;
    if (v && VALID_GRADES.has(v)) return v;
    warnings.push(kpiLabel);
    return null; // scorer handles null as missing (treated as 0 pts or excluded)
  }

  // ── Assortment & Margin (5 KPIs) ──────────────────────────────────────────
  const ceiBuying  = grade(rawGrades.ceiBuying,  'CEI Buying');
  const ceeRetail  = grade(rawGrades.ceeRetail,  'CEE Retail');
  const ceiProfit  = grade(rawGrades.ceiProfit,  'CEI Profit');
  const ceeCm1     = grade(rawGrades.ceeCm1,     'CEE CM1');
  const newItem    = grade(rawGrades.newItem,    'New Item%');

  // ── Quality Assurance (5 KPIs) ─────────────────────────────────────────────
  const passRate   = grade(rawGrades.passRate,   'Pass Rate');
  const defectRate = grade(rawGrades.defectRate, 'Defect Rate');
  const reInspect  = grade(rawGrades.reInspect,  'Re-inspection');
  const ivi        = grade(rawGrades.ivi,        'IVI');
  const returnRate = grade(rawGrades.returnRate, 'Return Rate');

  // ── Delivery & Fulfillment (3 KPIs) ────────────────────────────────────────
  const leadTime   = grade(rawGrades.leadTime,   'Lead Time');
  const onTime     = grade(rawGrades.onTime,     'On-time Rate');
  const otif       = grade(rawGrades.otif,       'OTIF');

  // ── Operation (4 KPIs) ─────────────────────────────────────────────────────
  const vessel     = grade(rawGrades.vessel,     'Vessel Booking');
  const inspBook   = grade(rawGrades.inspBook,   'Inspection Booking');
  const orderConf  = grade(rawGrades.orderConf,  'Order Confirmation');
  const comms      = grade(rawGrades.comms,      'Communication');

  // ── Terms & Conditions (6 KPIs) ────────────────────────────────────────────
  const payment    = grade(rawGrades.payment,    'Payment Terms');
  const fob        = grade(rawGrades.fob,        'FOB Terms');
  const remission  = grade(rawGrades.remission,  'Remission %');
  const bonus      = grade(rawGrades.bonus,      'Agreed Bonus');
  const mov        = grade(rawGrades.mov,        'MOV Required');
  const autoBonus  = grade(rawGrades.autoBonus,  'Auto Bonus');

  // ── Sustainability (1 KPI) ────────────────────────────────────────────────
  const sustainability = grade(rawGrades.sustainability, 'Sustainability');

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
