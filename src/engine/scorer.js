/**
 * scorer.js
 * Returns pillar scores and tier from pre-computed Excel values.
 * Scores are read directly from the Results sheet (cols 29–35) to ensure
 * 100% parity with the Excel formula — no re-computation needed.
 */

const WEIGHTS = {
  assortment:     0.30, // 30%
  quality:        0.25, // 25%
  delivery:       0.20, // 20%
  operation:      0.15, // 15%
  terms:          0.05, // 5%
  sustainability: 0.05, // 5%
};

/**
 * Build the pillars object and total score from pre-computed Excel scores.
 *
 * @param {object} excelScores - from parser.scoresMap[vendorNo]
 *   { assortment, quality, delivery, operation, terms, sustainability, total }
 * @returns {object} { pillars, totalScore, tier }
 */
function calcScores(excelScores) {
  // Round each pillar score to 2 decimal places (matching Excel display)
  const round2 = (v) => parseFloat(Number(v || 0).toFixed(2));

  const assortment    = round2(excelScores.assortment);
  const quality       = round2(excelScores.quality);
  const delivery      = round2(excelScores.delivery);
  const operation     = round2(excelScores.operation);
  const terms         = round2(excelScores.terms);
  const sustainability = round2(excelScores.sustainability);

  // Use Excel's own total — avoids any floating point accumulation differences
  const totalScore = round2(excelScores.total);

  return {
    pillars: {
      assortment:     { score: assortment,     weight: '30%', maxScore: 30 },
      quality:        { score: quality,         weight: '25%', maxScore: 25 },
      delivery:       { score: delivery,        weight: '20%', maxScore: 20 },
      operation:      { score: operation,       weight: '15%', maxScore: 15 },
      terms:          { score: terms,           weight: '5%',  maxScore: 5  },
      sustainability: { score: sustainability,  weight: '5%',  maxScore: 5  },
    },
    totalScore,
    tier: assignTier(totalScore),
  };
}

function assignTier(score) {
  if (score >= 85) return 'Strategic Partner';
  if (score >= 70) return 'Preferred Supplier';
  if (score >= 50) return 'Approved Supplier';
  return 'At Risk';
}

module.exports = { calcScores, assignTier };
