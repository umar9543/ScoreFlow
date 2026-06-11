/**
 * scorer.js
 * Calculates pillar scores and total score from A/B/C grades.
 * Assigns tier based on total score.
 */

const WEIGHTS = {
  assortment:    0.30, // 30%
  quality:       0.25, // 25%
  delivery:      0.20, // 20%
  operation:     0.15, // 15%
  terms:         0.05, // 5%
  sustainability: 0.05, // 5%
};

const pts = { A: 3, B: 2, C: 1 };

function points(grade) {
  return pts[grade] || 1;
}

function pillarScore(grades, weight) {
  const maxPts = grades.length * 3;
  const gotPts = grades.reduce((sum, g) => sum + points(g), 0);
  return parseFloat(((gotPts / maxPts) * weight * 100).toFixed(2));
}

/**
 * Calculate all pillar scores and total for a supplier.
 * @param {object} grades - from grader.gradeSupplier()
 * @returns {object} { pillars, totalScore, tier }
 */
function calcScores(grades) {
  const assortment = pillarScore(
    [grades.ceiBuying, grades.ceeRetail, grades.ceiProfit, grades.ceeCm1, grades.newItem],
    WEIGHTS.assortment
  );

  const quality = pillarScore(
    [grades.passRate, grades.defectRate, grades.reInspect, grades.ivi, grades.returnRate],
    WEIGHTS.quality
  );

  const delivery = pillarScore(
    [grades.leadTime, grades.onTime, grades.otif],
    WEIGHTS.delivery
  );

  const operation = pillarScore(
    [grades.vessel, grades.inspBook, grades.orderConf, grades.comms],
    WEIGHTS.operation
  );

  const terms = pillarScore(
    [grades.payment, grades.fob, grades.remission, grades.bonus, grades.mov, grades.autoBonus],
    WEIGHTS.terms
  );

  const sustainability = pillarScore(
    [grades.sustainability],
    WEIGHTS.sustainability
  );

  const totalScore = parseFloat(
    (assortment + quality + delivery + operation + terms + sustainability).toFixed(2)
  );

  return {
    pillars: {
      assortment:     { score: assortment,    weight: '30%', maxScore: 30 },
      quality:        { score: quality,        weight: '25%', maxScore: 25 },
      delivery:       { score: delivery,       weight: '20%', maxScore: 20 },
      operation:      { score: operation,      weight: '15%', maxScore: 15 },
      terms:          { score: terms,          weight: '5%',  maxScore: 5  },
      sustainability: { score: sustainability, weight: '5%',  maxScore: 5  },
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
