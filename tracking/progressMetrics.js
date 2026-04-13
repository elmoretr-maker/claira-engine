/**
 * Full time-series progress analysis (local data only).
 */

/**
 * @param {number[]} arr
 */
function mean(arr) {
  if (!arr.length) return NaN;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

/**
 * @param {number[]} arr
 */
function stdDev(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(mean(arr.map((x) => (x - m) ** 2)));
}

/**
 * @param {number[]} arr
 */
function coefficientOfVariation(arr) {
  const m = mean(arr);
  if (!Number.isFinite(m) || m === 0) return null;
  return stdDev(arr) / Math.abs(m);
}

/**
 * @param {number[]} arr
 */
function median(arr) {
  const s = arr.filter((x) => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return NaN;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * @param {{ timestamp?: string }} x
 */
function tsMs(x) {
  const t = Date.parse(String(x?.timestamp ?? ""));
  return Number.isFinite(t) ? t : NaN;
}

/**
 * @param {unknown} snap
 */
function manualFrom(snap) {
  const ed =
    snap && typeof snap === "object" && snap !== null ? /** @type {{ extractedData?: unknown }} */ (snap).extractedData : null;
  const mm =
    ed && typeof ed === "object" && ed !== null ? /** @type {{ manualMetrics?: unknown }} */ (ed).manualMetrics : null;
  return mm && typeof mm === "object" && !Array.isArray(mm) ? /** @type {Record<string, number>} */ (mm) : {};
}

/**
 * @param {unknown} snap
 */
function sourceAspectFromSnap(snap) {
  const ed = snap && typeof snap === "object" && snap !== null ? /** @type {{ extractedData?: unknown }} */ (snap).extractedData : null;
  if (!ed || typeof ed !== "object") return null;
  const n = /** @type {{ normalization?: { sourceAspect?: number } }} */ (ed).normalization;
  if (n && typeof n.sourceAspect === "number" && Number.isFinite(n.sourceAspect)) return n.sourceAspect;
  const r = /** @type {{ ratios?: { sourceAspectRecorded?: number } }} */ (ed).ratios;
  if (r && typeof r.sourceAspectRecorded === "number") return r.sourceAspectRecorded;
  const p = /** @type {{ proportions?: { widthOverHeight?: number } }} */ (ed).proportions;
  if (p && typeof p.widthOverHeight === "number") return p.widthOverHeight;
  return null;
}

/**
 * @param {unknown} snap
 */
function sourceLongEdgeFromSnap(snap) {
  const ed = snap && typeof snap === "object" && snap !== null ? /** @type {{ extractedData?: unknown }} */ (snap).extractedData : null;
  if (!ed || typeof ed !== "object") return null;
  const n = /** @type {{ normalization?: { sourceLongEdge?: number } }} */ (ed).normalization;
  if (n && typeof n.sourceLongEdge === "number" && n.sourceLongEdge > 0) return n.sourceLongEdge;
  const r = /** @type {{ ratios?: { sourceLongEdgeRecorded?: number } }} */ (ed).ratios;
  if (r && typeof r.sourceLongEdgeRecorded === "number") return r.sourceLongEdgeRecorded;
  const sr = /** @type {{ sizeRatios?: { longSide?: number } }} */ (ed).sizeRatios;
  if (sr && typeof sr.longSide === "number") return sr.longSide;
  return null;
}

/**
 * @param {unknown} snap
 */
function snapshotHasImagePath(snap) {
  if (!snap || typeof snap !== "object") return false;
  const p = /** @type {{ imagePath?: string | null, rawData?: { imagePath?: string | null } }} */ (snap).imagePath;
  if (typeof p === "string" && p.length > 0) return true;
  const rd = /** @type {{ rawData?: { imagePath?: string | null } }} */ (snap).rawData;
  const rp = rd && typeof rd === "object" ? rd.imagePath : null;
  return typeof rp === "string" && rp.length > 0;
}

/**
 * @param {number[]} deltas
 * @param {number} overallDelta
 */
function trendConsistencyRatio(deltas, overallDelta) {
  if (!deltas.length) return 1;
  if (Math.abs(overallDelta) < 1e-9) {
    const absMean = mean(deltas.map((d) => Math.abs(d)));
    if (absMean < 1e-9) return 1;
    const sd = stdDev(deltas);
    return Math.max(0, Math.min(1, Math.round((1 - Math.min(1, sd / (absMean + 1e-6))) * 1000) / 1000));
  }
  const targetSign = overallDelta > 0 ? 1 : -1;
  let match = 0;
  for (const d of deltas) {
    const s = d === 0 ? 0 : d > 0 ? 1 : -1;
    if (s === targetSign) match += 1;
    else if (d === 0) match += 0.5;
  }
  return Math.round((match / deltas.length) * 1000) / 1000;
}

/**
 * @param {number[]} rates per day
 */
function accelerationLabel(rates) {
  if (rates.length < 2) return "steady";
  const mid = Math.floor(rates.length / 2);
  const first = mean(rates.slice(0, mid + 1));
  const second = mean(rates.slice(mid));
  const diff = second - first;
  const eps = 1e-6;
  if (Math.abs(diff) < eps * (Math.abs(first) + Math.abs(second) + 1)) return "steady";
  return diff > 0 ? "speeding_up" : "slowing_down";
}

/**
 * @param {number[]} rates
 * @param {number} consistency
 */
function trendStabilityScore(rates, consistency) {
  let score = 100;
  if (rates.length >= 2) {
    const cv = coefficientOfVariation(rates.filter(Number.isFinite));
    if (cv != null && Number.isFinite(cv)) {
      score -= Math.min(50, cv * 80);
    }
  }
  score -= (1 - consistency) * 40;
  return Math.max(0, Math.min(100, Math.round(score)));
}

const VISUAL_HINT =
  "Keep camera distance consistent. Use similar framing for best results.";

const RETAKE_IMAGE_GUIDANCE = "Consider retaking this image for better accuracy.";

const DEFAULT_FRAMING_ASPECT_THRESHOLD = 0.35;
const DEFAULT_SCALE_CV_THRESHOLD = 0.28;

/**
 * @param {Array<Record<string, unknown>>} snapshots oldest-first (hydrated: expect extractedData for signal reads)
 * @param {{ framingAspectThreshold?: number, scaleCvThreshold?: number }} [consistencyConfig] global + optional industry overrides
 */
export function computeProgressMetrics(snapshots, consistencyConfig = {}) {
  const framingTh = Number.isFinite(consistencyConfig.framingAspectThreshold)
    ? /** @type {number} */ (consistencyConfig.framingAspectThreshold)
    : DEFAULT_FRAMING_ASPECT_THRESHOLD;
  const scaleTh = Number.isFinite(consistencyConfig.scaleCvThreshold)
    ? /** @type {number} */ (consistencyConfig.scaleCvThreshold)
    : DEFAULT_SCALE_CV_THRESHOLD;

  const sorted = [...snapshots].sort((a, b) => tsMs(a) - tsMs(b));
  if (sorted.length < 2) {
    return {
      trend: "insufficient_data",
      changes: [],
      percentageDifferences: [],
      direction: "flat",
      consistencyWarning: null,
      consistencyDetails: null,
      visualQualityHint: null,
      timeSeriesAnalysis: null,
      imageConsistency: null,
      snapshotCount: sorted.length,
      resolvedConsistencyThresholds: { framingAspectThreshold: framingTh, scaleCvThreshold: scaleTh },
    };
  }

  const hasImages = sorted.some((s) => {
    if (!s || typeof s !== "object") return false;
    const p = /** @type {{ imagePath?: string | null, rawData?: { imagePath?: string | null } }} */ (s).imagePath;
    if (typeof p === "string" && p.length > 0) return true;
    const rd = /** @type {{ rawData?: { imagePath?: string | null } }} */ (s).rawData;
    const rp = rd && typeof rd === "object" ? rd.imagePath : null;
    return typeof rp === "string" && rp.length > 0;
  });

  const aspects = sorted.map(sourceAspectFromSnap).filter((x) => typeof x === "number" && Number.isFinite(x));
  const longEdges = sorted.map(sourceLongEdgeFromSnap).filter((x) => typeof x === "number" && x > 0);

  let aspectSpread = 0;
  if (aspects.length >= 2) {
    aspectSpread = Math.max(...aspects) - Math.min(...aspects);
  }
  const scaleCv = longEdges.length >= 2 ? coefficientOfVariation(longEdges) : null;

  const framingDeviationExceeded = aspects.length >= 2 && aspectSpread > framingTh;
  const scaleDeviationExceeded = scaleCv != null && scaleCv > scaleTh;

  /** @type {string | null} */
  let consistencyWarning = null;
  if (framingDeviationExceeded || scaleDeviationExceeded) {
    consistencyWarning = "Inconsistent image framing detected — results may be less accurate.";
  }

  /** @type {Record<string, unknown>} */
  const consistencyDetails = {
    framingAspectSpread: Math.round(aspectSpread * 1000) / 1000,
    scaleCoefficientOfVariation: scaleCv != null ? Math.round(scaleCv * 1000) / 1000 : null,
    snapshotCountWithAspect: aspects.length,
    snapshotCountWithLongEdge: longEdges.length,
    framingDeviationExceeded,
    scaleDeviationExceeded,
    thresholds: { framingAspectThreshold: framingTh, scaleCvThreshold: scaleTh },
  };

  /** @type {"unknown" | "consistent" | "moderate" | "inconsistent"} */
  let scaleConsistencyLabel = "unknown";
  if (scaleCv != null && Number.isFinite(scaleCv)) {
    if (scaleCv <= scaleTh * 0.5) scaleConsistencyLabel = "consistent";
    else if (scaleCv <= scaleTh) scaleConsistencyLabel = "moderate";
    else scaleConsistencyLabel = "inconsistent";
  }

  /** @type {Record<string, unknown>} */
  const imageConsistency = {
    thresholds: { framingAspectThreshold: framingTh, scaleCvThreshold: scaleTh },
    framingAspectSpread: consistencyDetails.framingAspectSpread,
    scaleCoefficientOfVariation: consistencyDetails.scaleCoefficientOfVariation,
    framingDeviationExceeded,
    scaleDeviationExceeded,
    scaleConsistencyLabel,
    aspectRatioSeries: sorted.map((s, index) => ({
      index,
      timestamp: /** @type {{ timestamp?: string }} */ (s).timestamp,
      aspect: sourceAspectFromSnap(s),
    })),
    longEdgeSeries: sorted.map((s, index) => ({
      index,
      timestamp: /** @type {{ timestamp?: string }} */ (s).timestamp,
      longEdgePx: sourceLongEdgeFromSnap(s),
    })),
  };

  /** @type {string | null} */
  const visualQualityHint = hasImages && sorted.length >= 2 ? VISUAL_HINT : null;

  /** @type {Record<string, unknown>} */
  const manualMetricsAnalysis = {};

  const allKeys = new Set();
  for (const s of sorted) {
    for (const k of Object.keys(manualFrom(s))) allKeys.add(k);
  }

  /** @type {Array<{ metric: string, from: number, to: number, pct: number | null }>} */
  const percentageDifferences = [];
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const mFirst = manualFrom(first);
  const mLast = manualFrom(last);

  for (const k of allKeys) {
    const v0 = mFirst[k];
    const v1 = mLast[k];
    if (Number.isFinite(v0) && Number.isFinite(v1) && v0 !== 0) {
      const pct = Math.round(((v1 - v0) / Math.abs(v0)) * 10000) / 100;
      percentageDifferences.push({ metric: k, from: Number(v0), to: Number(v1), pct });
    }

    /** @type {Array<{ t: number, v: number }>} */
    const series = [];
    for (const s of sorted) {
      const t = tsMs(s);
      const m = manualFrom(s)[k];
      if (Number.isFinite(t) && Number.isFinite(m)) series.push({ t, v: Number(m) });
    }
    if (series.length < 2) continue;

    /** @type {Array<{ fromIdx: number, toIdx: number, daysDelta: number, valueDelta: number, ratePerDay: number | null }>} */
    const intervalRates = [];
    /** @type {number[]} */
    const dvs = [];
    /** @type {number[]} */
    const rates = [];
    for (let i = 1; i < series.length; i++) {
      const dtMs = series[i].t - series[i - 1].t;
      const daysDelta = dtMs > 0 ? dtMs / 86400000 : 0;
      const valueDelta = series[i].v - series[i - 1].v;
      dvs.push(valueDelta);
      const ratePerDay = daysDelta > 1e-6 ? valueDelta / daysDelta : null;
      if (ratePerDay != null && Number.isFinite(ratePerDay)) rates.push(ratePerDay);
      intervalRates.push({
        fromIdx: i - 1,
        toIdx: i,
        daysDelta: Math.round(daysDelta * 1000) / 1000,
        valueDelta: Math.round(valueDelta * 1000) / 1000,
        ratePerDay: ratePerDay != null ? Math.round(ratePerDay * 10000) / 10000 : null,
      });
    }

    const overallDelta = series[series.length - 1].v - series[0].v;
    const consistency = trendConsistencyRatio(dvs, overallDelta);

    /** rolling average of value deltas (window 3) */
    let rollingAvgChange = null;
    if (dvs.length) {
      const win = Math.min(3, dvs.length);
      rollingAvgChange = Math.round(mean(dvs.slice(-win)) * 10000) / 10000;
    }

    const accel = accelerationLabel(rates);
    const stability = trendStabilityScore(rates, consistency);

    manualMetricsAnalysis[k] = {
      series: series.map((p) => ({ t: p.t, v: p.v })),
      intervalRates,
      rollingAvgChange,
      trendConsistency: consistency,
      acceleration: accel,
      trendStabilityScore: stability,
    };
  }

  /** Aspect ratio time series (from source / pre-normalize metadata) */
  const aspectSeries = sorted
    .map((s) => ({ t: tsMs(s), a: sourceAspectFromSnap(s) }))
    .filter((x) => Number.isFinite(x.t) && typeof x.a === "number");
  let aspectTimeSeries = null;
  if (aspectSeries.length >= 2) {
    const dvs = [];
    const rates = [];
    for (let i = 1; i < aspectSeries.length; i++) {
      const dt = (aspectSeries[i].t - aspectSeries[i - 1].t) / 86400000;
      const dv = /** @type {number} */ (aspectSeries[i].a) - /** @type {number} */ (aspectSeries[i - 1].a);
      dvs.push(dv);
      if (dt > 1e-6) rates.push(dv / dt);
    }
    const aspectOverall =
      /** @type {number} */ (aspectSeries[aspectSeries.length - 1].a) -
      /** @type {number} */ (aspectSeries[0].a);
    const aspConsist = trendConsistencyRatio(dvs, aspectOverall);
    aspectTimeSeries = {
      trendConsistency: aspConsist,
      acceleration: accelerationLabel(rates),
      trendStabilityScore: trendStabilityScore(rates, aspConsist),
    };
  }

  const asp0 = sourceAspectFromSnap(first);
  const asp1 = sourceAspectFromSnap(last);
  if (typeof asp0 === "number" && typeof asp1 === "number" && asp0 !== 0) {
    percentageDifferences.push({
      metric: "image_aspect_source",
      from: asp0,
      to: asp1,
      pct: Math.round(((asp1 - asp0) / Math.abs(asp0)) * 10000) / 100,
    });
  }

  /** Global direction from mean of manual metric overall deltas */
  /** @type {number[]} */
  const overallDeltas = [];
  for (const k of Object.keys(manualMetricsAnalysis)) {
    const ma = /** @type {{ series?: { v: number }[] }} */ (manualMetricsAnalysis[k]);
    const ser = Array.isArray(ma.series) ? ma.series : [];
    if (ser.length >= 2) {
      overallDeltas.push(ser[ser.length - 1].v - ser[0].v);
    }
  }
  let direction = "flat";
  if (overallDeltas.length) {
    const avg = mean(overallDeltas);
    if (avg > 1e-6) direction = "up";
    else if (avg < -1e-6) direction = "down";
  } else if (percentageDifferences.length) {
    const pcts = percentageDifferences.map((x) => x.pct).filter((p) => p != null && Number.isFinite(p));
    if (pcts.length) {
      const avg = mean(pcts);
      if (avg > 1) direction = "up";
      else if (avg < -1) direction = "down";
    }
  }

  const stabilityScores = Object.values(manualMetricsAnalysis)
    .map((x) => /** @type {{ trendStabilityScore?: number }} */ (x).trendStabilityScore)
    .filter((n) => typeof n === "number");
  const globalTrendStabilityScore =
    stabilityScores.length > 0 ? Math.round(mean(stabilityScores)) : aspectTimeSeries?.trendStabilityScore ?? null;

  const aspectMedian = aspects.length >= 2 ? median(aspects) : NaN;
  const longEdgeMedian = longEdges.length >= 2 ? median(longEdges) : NaN;

  const changes = sorted.map((s, i) => {
    const hasImage = snapshotHasImagePath(s);
    const a = sourceAspectFromSnap(s);
    const le = sourceLongEdgeFromSnap(s);

    /** @type {number | null} */
    let framingScore = null;
    /** @type {number | null} */
    let scaleScore = null;
    let framingLow = false;
    let scaleLow = false;

    if (Number.isFinite(aspectMedian) && typeof a === "number" && Number.isFinite(a)) {
      const d = Math.abs(a - aspectMedian);
      framingScore = Math.round(100 * Math.max(0, Math.min(1, 1 - d / (framingTh + 1e-9))));
      framingLow = d > framingTh;
    }
    if (Number.isFinite(longEdgeMedian) && typeof le === "number" && le > 0) {
      const rel = Math.abs(le - longEdgeMedian) / longEdgeMedian;
      scaleScore = Math.round(100 * Math.max(0, Math.min(1, 1 - rel / (scaleTh + 1e-9))));
      scaleLow = rel > scaleTh;
    }

    /** @type {"good" | "inconsistent" | "n_a"} */
    let status = "n_a";
    /** @type {string | null} */
    let guidance = null;

    if (!hasImage) {
      status = "n_a";
    } else {
      const canScoreFraming = Number.isFinite(aspectMedian) && typeof a === "number" && Number.isFinite(a);
      const canScoreScale = Number.isFinite(longEdgeMedian) && typeof le === "number" && le > 0;
      if (canScoreFraming || canScoreScale) {
        const inconsistent = (canScoreFraming && framingLow) || (canScoreScale && scaleLow);
        status = inconsistent ? "inconsistent" : "good";
        if (inconsistent) guidance = RETAKE_IMAGE_GUIDANCE;
      } else {
        status = "good";
      }
    }

    return {
      index: i,
      timestamp: s.timestamp,
      id: /** @type {{ id?: string }} */ (s).id,
      imageQuality: {
        hasImage,
        framingScore,
        scaleScore,
        framingLow,
        scaleLow,
        status,
        guidance,
      },
    };
  });

  return {
    trend: "tracked",
    snapshotCount: sorted.length,
    firstTimestamp: first.timestamp,
    lastTimestamp: last.timestamp,
    changes,
    percentageDifferences,
    direction,
    consistencyWarning,
    consistencyDetails,
    visualQualityHint,
    timeSeriesAnalysis: {
      manualMetrics: manualMetricsAnalysis,
      imageAspect: aspectTimeSeries,
      globalTrendStabilityScore,
      aspectRatioSeries: imageConsistency.aspectRatioSeries,
      scaleConsistency: {
        coefficientOfVariation: scaleCv,
        label: scaleConsistencyLabel,
        snapshotCount: longEdges.length,
      },
      rollingAverageSummary:
        Object.keys(manualMetricsAnalysis).length > 0
          ? Object.fromEntries(
              Object.entries(manualMetricsAnalysis).map(([k, v]) => [
                k,
                /** @type {{ rollingAvgChange?: number | null }} */ (v).rollingAvgChange ?? null,
              ]),
            )
          : null,
    },
    imageConsistency,
    resolvedConsistencyThresholds: { framingAspectThreshold: framingTh, scaleCvThreshold: scaleTh },
  };
}
