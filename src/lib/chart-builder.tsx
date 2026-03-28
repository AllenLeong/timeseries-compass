/**
 * Shared chart data building and element rendering logic.
 * Used by both CurvesPage (preview) and DetailPage (display).
 */
import React from 'react';
import { parseListValue } from './csv-parser';
import type {
  ChartTemplate, SeriesDisplayConfig, FieldConfig, FillAreaConfig,
  ReferenceLine, ReferenceAreaConfig, YAxisFormat,
} from './csv-parser';
import {
  CURVE_COLORS, applySmoothing, applyRolling, applyAccumulative,
  DEFAULT_SERIES_CONFIG, getStrokeDasharray, formatYValue,
  buildCategoricalSegments, buildCategoryColorMap,
} from './curve-utils';
import type { CategoricalSegment } from './curve-utils';
import {
  Line, Area,
  ReferenceLine as RechartRefLine,
  ReferenceArea as RechartRefArea,
} from 'recharts';

// ── Helpers ─────────────────────────────────────────

/** Get or create series config for a column */
export function getSeriesConfig(
  template: ChartTemplate,
  col: string,
): SeriesDisplayConfig {
  return template.seriesConfig?.[col] ?? { ...DEFAULT_SERIES_CONFIG };
}

/** Identify which Y columns are prediction-related */
export function getPredColSet(fieldConfig: FieldConfig | null): Set<string> {
  if (!fieldConfig?.prediction) return new Set();
  const cols: string[] = [];
  for (const m of fieldConfig.prediction.predictions) {
    if (m.predictionCol) cols.push(m.predictionCol);
    if (m.upperBoundCol) cols.push(m.upperBoundCol);
    if (m.lowerBoundCol) cols.push(m.lowerBoundCol);
  }
  return new Set(cols);
}

// ── Build Chart Data ────────────────────────────────

export interface BuildChartDataOptions {
  row: Record<string, unknown>;
  template: ChartTemplate;
  fieldConfig: FieldConfig | null;
  /** Force prediction handling even for templates (not just __pred_combo) */
  enablePrediction?: boolean;
}

/**
 * Build chart data points from a data row and template config.
 * Handles actual data, prediction data (with chained accumulation),
 * smoothing, rolling stats, and unified x-axis merging.
 */
export function buildChartData(opts: BuildChartDataOptions): Record<string, unknown>[] {
  const { row, template, fieldConfig, enablePrediction } = opts;
  if (!row || !template.xAxis) return [];
  const allY = [...template.yAxisLeft, ...template.yAxisRight];
  const xValues = parseListValue(row[template.xAxis]);
  if (!xValues) return [];

  const predColSet = getPredColSet(fieldConfig);
  // Determine if this chart has prediction columns
  const hasPredCols = enablePrediction || allY.some(c => predColSet.has(c));

  const regularCols = allY.filter(c => !predColSet.has(c));
  const selectedPredCols = allY.filter(c => predColSet.has(c));

  const rawSeries: Record<string, number[]> = {};

  // Process regular (actual) columns
  regularCols.forEach(col => {
    const vals = parseListValue(row[col]);
    let data = vals ? vals.map(Number) : [];
    const cfg = getSeriesConfig(template, col);
    if (cfg.accumulative && cfg.accumulative !== 'none') {
      data = applyAccumulative(data, cfg.accumulative);
    }
    rawSeries[col] = data;
  });

  // Build unified x-axis: actual timepoints + prediction-only timepoints
  const xStrs = xValues.map(String);
  const xSet = new Set(xStrs);
  let predXStrs: string[] = [];

  if (hasPredCols && fieldConfig?.prediction) {
    const predXValues = parseListValue(row[fieldConfig.prediction.timepoint]);
    if (predXValues && predXValues.length > 0) {
      predXStrs = predXValues.map(String);
    }
  }

  // Process prediction columns — chain accumulation from actual if both selected
  selectedPredCols.forEach(col => {
    const vals = parseListValue(row[col]);
    let data = vals ? vals.map(Number) : [];
    const cfg = getSeriesConfig(template, col);

    if (cfg.accumulative && cfg.accumulative !== 'none' && fieldConfig?.prediction) {
      const mapping = fieldConfig.prediction.predictions.find(m =>
        m.predictionCol === col || m.upperBoundCol === col || m.lowerBoundCol === col
      );
      const actualCol = mapping?.actualCol;
      const actualData = actualCol ? rawSeries[actualCol] : undefined;

      if (actualData && actualData.length > 0) {
        const lastActualVal = actualData[actualData.length - 1];
        const result: number[] = [];
        let sum = lastActualVal;
        for (let i = 0; i < data.length; i++) {
          sum += data[i];
          result.push(cfg.accumulative === 'sum' ? sum : sum / (actualData.length + i + 1));
        }
        data = result;
      } else {
        data = applyAccumulative(data, cfg.accumulative);
      }
    } else if (cfg.accumulative && cfg.accumulative !== 'none') {
      data = applyAccumulative(data, cfg.accumulative);
    }

    rawSeries[col] = data;
  });

  // Unified x-axis: merge actual + prediction timepoints, sorted, deduplicated
  const predOnlyX = predXStrs.filter(x => !xSet.has(x));
  const allXUnsorted = [...xStrs, ...predOnlyX];
  const allX = allXUnsorted.sort((a, b) => {
    const na = Number(a), nb = Number(b);
    return (!isNaN(na) && !isNaN(nb)) ? na - nb : a.localeCompare(b);
  });

  // Also handle __pred_combo prediction data (actual + pred with separate keys)
  const predMappings = fieldConfig?.prediction?.predictions.filter(
    m => regularCols.includes(m.actualCol)
  ) ?? [];

  const points: Record<string, unknown>[] = allX.map((x, i) => {
    const point: Record<string, unknown> = { x, index: i };
    const actualIdx = xStrs.indexOf(x);

    // Fill actual Y data
    if (actualIdx >= 0) {
      [...regularCols, ...selectedPredCols].forEach(col => {
        const isRegular = regularCols.includes(col);
        const isPred = selectedPredCols.includes(col);
        // For pred cols, they use predXStrs indices, not actualIdx
        if (isPred) return; // handled below
        const cfg = getSeriesConfig(template, col);
        const raw = rawSeries[col];
        if (!raw?.length) return;

        if (cfg.showRaw && raw[actualIdx] !== undefined) point[col] = raw[actualIdx];
        if (cfg.smooth !== 'none') {
          const baseVals = parseListValue(row[col]);
          const baseData = baseVals ? baseVals.map(Number) : [];
          const smoothed = applySmoothing(baseData, cfg.smooth, cfg.smoothWindow);
          if (smoothed[actualIdx] !== undefined) point[`${col}__smooth`] = smoothed[actualIdx];
        }
        if (cfg.rolling) {
          const baseVals = parseListValue(row[col]);
          const baseData = baseVals ? baseVals.map(Number) : [];
          if (cfg.rolling === 'std') {
            const mean = applyRolling(baseData, cfg.rollingWindow, 'mean');
            const std = applyRolling(baseData, cfg.rollingWindow, 'std');
            if (mean[actualIdx] !== undefined && std[actualIdx] !== undefined) {
              point[`${col}__rolling_upper`] = mean[actualIdx] + std[actualIdx];
              point[`${col}__rolling_lower`] = mean[actualIdx] - std[actualIdx];
            }
          } else {
            const rolled = applyRolling(baseData, cfg.rollingWindow, cfg.rolling);
            if (rolled[actualIdx] !== undefined) point[`${col}__rolling`] = rolled[actualIdx];
          }
        }
      });
    }

    // Fill prediction columns data (using predXStrs index)
    if (selectedPredCols.length > 0 && predXStrs.length > 0) {
      const predIdx = predXStrs.indexOf(x);
      if (predIdx >= 0) {
        selectedPredCols.forEach(col => {
          const data = rawSeries[col];
          if (!data) return;
          let idx = predIdx;
          if (data.length === xStrs.length && actualIdx >= 0) {
            idx = actualIdx;
          } else if (data.length !== predXStrs.length && predIdx >= data.length) {
            return;
          }
          const v = data[idx];
          if (v !== undefined && !isNaN(v)) point[col] = v;
        });
      }
    }

    // Fill __pred_combo style prediction data (actual + pred with __pred suffix)
    if (predMappings.length > 0 && predXStrs.length > 0) {
      const predIdx = predXStrs.indexOf(x);
      if (predIdx >= 0) {
        for (const mapping of predMappings) {
          const predValues = parseListValue(row[mapping.predictionCol]);
          if (predValues) {
            const pIdx = predValues.length === predXStrs.length ? predIdx : predIdx;
            if (pIdx >= 0 && pIdx < predValues.length) {
              const v = Number(predValues[pIdx]);
              if (!isNaN(v)) point[`${mapping.actualCol}__pred`] = v;
            }
          }
          let upperVal: number | undefined;
          let lowerVal: number | undefined;
          if (mapping.upperBoundCol) {
            const upperValues = parseListValue(row[mapping.upperBoundCol]);
            if (upperValues) {
              const uIdx = upperValues.length === predXStrs.length ? predIdx : predIdx;
              if (uIdx >= 0 && uIdx < upperValues.length) {
                const v = Number(upperValues[uIdx]);
                if (!isNaN(v)) { point[`${mapping.actualCol}__pred_upper`] = v; upperVal = v; }
              }
            }
          }
          if (mapping.lowerBoundCol) {
            const lowerValues = parseListValue(row[mapping.lowerBoundCol]);
            if (lowerValues) {
              const lIdx = lowerValues.length === predXStrs.length ? predIdx : predIdx;
              if (lIdx >= 0 && lIdx < lowerValues.length) {
                const v = Number(lowerValues[lIdx]);
                if (!isNaN(v)) { point[`${mapping.actualCol}__pred_lower`] = v; lowerVal = v; }
              }
            }
          }
          // Compute stacking keys for proper band rendering (no background mask)
          if (upperVal != null && lowerVal != null) {
            point[`${mapping.actualCol}__pred_band_base`] = lowerVal;
            point[`${mapping.actualCol}__pred_band_gap`] = upperVal - lowerVal;
          }
        }
      }
    }

    // Compute fill area derived keys (base + gap for stacking)
    if (template.fillAreas?.length) {
      template.fillAreas.forEach(fa => {
        if (!fa.series1 || !fa.series2) return;
        const v1 = point[fa.series1] as number | undefined;
        const v2 = point[fa.series2] as number | undefined;
        if (v1 != null && v2 != null) {
          const lower = Math.min(v1, v2);
          const gap = Math.abs(v1 - v2);
          point[`__fill_${fa.id}_base`] = lower;
          point[`__fill_${fa.id}_gap`] = gap;
        }
      });
    }

    return point;
  });

  return points;
}

// ── Build Categorical Segments ──────────────────────

export function buildCatSegments(
  row: Record<string, unknown>,
  template: ChartTemplate,
  globalCatColorMap?: Record<string, string>,
): CategoricalSegment[] {
  if (!template.categoricalCols?.length) return [];
  const xValues = parseListValue(row[template.xAxis]);
  if (!xValues) return [];
  const xStrs = xValues.map(String);
  const allSegs: CategoricalSegment[] = [];
  template.categoricalCols.forEach(col => {
    const vals = parseListValue(row[col]);
    if (!vals) return;
    const strVals = vals.map(String);
    const colorMap = globalCatColorMap ?? buildCategoryColorMap(strVals);
    allSegs.push(...buildCategoricalSegments(xStrs, strVals, col, colorMap));
  });
  return allSegs;
}

// ── Build Chart Lines (React elements) ──────────────

export interface BuildChartLinesOptions {
  template: ChartTemplate;
  /** For __pred_combo charts (DetailPage auto-generated configs) */
  isPredCombo?: boolean;
  fieldConfig?: FieldConfig | null;
  row?: Record<string, unknown>;
}

/**
 * Build all Line/Area React elements for a chart.
 * Handles raw lines, smoothed lines, rolling bands, fill areas,
 * prediction bands and lines.
 */
export function buildChartLines(opts: BuildChartLinesOptions): React.ReactNode[] {
  const { template, isPredCombo, fieldConfig, row } = opts;
  const elements: React.ReactNode[] = [];
  const predColSet = getPredColSet(fieldConfig ?? null);
  const allY = [...template.yAxisLeft, ...template.yAxisRight];
  const hasPredCols = allY.some(c => predColSet.has(c));

  // Fill areas between two series using stacking (no background mask needed)
  if (template.fillAreas?.length) {
    template.fillAreas.forEach(fa => {
      if (!fa.series1 || !fa.series2) return;
      const stackId = `fill_${fa.id}`;
      // Invisible base area (from 0 to min of the two series)
      elements.push(
        <Area key={`fill_${fa.id}_base`} yAxisId="left" type="monotone"
          dataKey={`__fill_${fa.id}_base`}
          stackId={stackId}
          stroke="none" fill="transparent" fillOpacity={0}
          isAnimationActive={false} legendType="none" />
      );
      // Visible gap area (from min to max, i.e. between the two series)
      elements.push(
        <Area key={`fill_${fa.id}_gap`} yAxisId="left" type="monotone"
          dataKey={`__fill_${fa.id}_gap`}
          stackId={stackId}
          stroke="none" fill={fa.color || 'hsl(var(--primary))'} fillOpacity={fa.opacity ?? 0.15}
          isAnimationActive={false} name={`${fa.series1} ↔ ${fa.series2}`} />
      );
    });
  }

  // Prediction bands FIRST (behind actual lines) — for __pred_combo charts
  // Uses invisible-base + visible-gap stacking to avoid background masking artifacts
  if (isPredCombo && fieldConfig?.prediction) {
    const predMaps = fieldConfig.prediction.predictions.filter(
      m => allY.includes(m.actualCol)
    );
    predMaps.forEach(mapping => {
      const predColor = 'hsl(var(--destructive))';
      if (mapping.upperBoundCol && mapping.lowerBoundCol) {
        const bandStackId = `pred_band_${mapping.actualCol}`;
        elements.push(
          <Area key={`${mapping.actualCol}__pred_band_base`} yAxisId="left" type="monotone"
            dataKey={`${mapping.actualCol}__pred_band_base`}
            stackId={bandStackId}
            stroke="none" fill="transparent" fillOpacity={0}
            connectNulls isAnimationActive={false}
            legendType="none" />
        );
        elements.push(
          <Area key={`${mapping.actualCol}__pred_band_gap`} yAxisId="left" type="monotone"
            dataKey={`${mapping.actualCol}__pred_band_gap`}
            stackId={bandStackId}
            stroke="none" fill={predColor} fillOpacity={0.1}
            connectNulls isAnimationActive={false}
            name={`${mapping.predictionCol} (interval)`} />
        );
      }
    });
  }

  // Series lines
  const addSeriesLines = (cols: string[], yAxisId: 'left' | 'right', colorOffset: number) => {
    const stackId = template.stacked ? `stack-${yAxisId}` : undefined;
    cols.forEach((col, i) => {
      const cfg = getSeriesConfig(template, col);
      const color = cfg.color || CURVE_COLORS[(colorOffset + i) % CURVE_COLORS.length];
      const isDashed = yAxisId === 'right';
      const sOpacity = cfg.opacity ?? 1;
      const dashArray = getStrokeDasharray(cfg.lineStyle) || (isDashed ? '5 5' : undefined);

      if (cfg.showRaw) {
        if (template.stacked) {
          elements.push(
            <Area key={`${col}__raw`} yAxisId={yAxisId} type="linear" dataKey={col}
              stroke="none" fill={color} fillOpacity={0.95 * sOpacity}
              stackId={stackId} name={col} />
          );
        } else {
          elements.push(
            <Line key={`${col}__raw`} yAxisId={yAxisId} type="monotone" dataKey={col}
              stroke={color} strokeWidth={2} dot={false}
              activeDot={{ r: 3, strokeWidth: 0 }}
              strokeDasharray={dashArray}
              opacity={sOpacity} name={col} />
          );
        }
      }
      if (cfg.smooth !== 'none') {
        elements.push(
          <Line key={`${col}__smooth`} yAxisId={yAxisId} type="monotone" dataKey={`${col}__smooth`}
            stroke={color} strokeWidth={1.5} dot={false}
            strokeDasharray="8 3" opacity={0.7 * sOpacity}
            name={`${col} (${cfg.smooth.replace('_', ' ')})`} />
        );
      }
      if (cfg.rolling) {
        if (cfg.rolling === 'std') {
          elements.push(
            <Line key={`${col}__upper`} yAxisId={yAxisId} type="monotone" dataKey={`${col}__rolling_upper`}
              stroke={color} strokeWidth={1} dot={false} opacity={0.4 * sOpacity}
              strokeDasharray="4 2"
              name={`${col} (+std)`} />
          );
          elements.push(
            <Line key={`${col}__lower`} yAxisId={yAxisId} type="monotone" dataKey={`${col}__rolling_lower`}
              stroke={color} strokeWidth={1} dot={false} opacity={0.4 * sOpacity}
              strokeDasharray="4 2"
              name={`${col} (−std)`} />
          );
        } else {
          elements.push(
            <Line key={`${col}__rolling`} yAxisId={yAxisId} type="monotone" dataKey={`${col}__rolling`}
              stroke={color} strokeWidth={1.5} dot={false}
              strokeDasharray="2 2" opacity={0.55 * sOpacity}
              name={`${col} (${cfg.rolling} w=${cfg.rollingWindow})`} />
          );
        }
      }
    });
  };

  addSeriesLines(template.yAxisLeft, 'left', 0);
  addSeriesLines(template.yAxisRight, 'right', template.yAxisLeft.length);

  // Prediction lines and bound outlines (on top) — for __pred_combo charts
  if (isPredCombo && fieldConfig?.prediction) {
    const predMaps = fieldConfig.prediction.predictions.filter(
      m => allY.includes(m.actualCol)
    );
    predMaps.forEach(mapping => {
      const predColor = 'hsl(var(--destructive))';
      elements.push(
        <Line key={`${mapping.actualCol}__pred`} yAxisId="left" type="monotone"
          dataKey={`${mapping.actualCol}__pred`}
          stroke={predColor} strokeWidth={2} dot={false}
          strokeDasharray="6 3" connectNulls
          name={`${mapping.predictionCol} (pred)`} />
      );
      if (mapping.upperBoundCol && mapping.lowerBoundCol) {
        elements.push(
          <Line key={`${mapping.actualCol}__pred_upper_line`} yAxisId="left" type="monotone"
            dataKey={`${mapping.actualCol}__pred_upper`}
            stroke={predColor} strokeWidth={1} dot={false} opacity={0.3}
            connectNulls legendType="none" />
        );
        elements.push(
          <Line key={`${mapping.actualCol}__pred_lower_line`} yAxisId="left" type="monotone"
            dataKey={`${mapping.actualCol}__pred_lower`}
            stroke={predColor} strokeWidth={1} dot={false} opacity={0.3}
            connectNulls legendType="none" />
        );
      }
    });
  }

  return elements;
}

// ── Build Reference Lines/Areas (React elements) ────

export function buildReferenceElements(
  template: ChartTemplate,
  data: Record<string, unknown>[],
  row?: Record<string, unknown>,
): React.ReactNode[] {
  const elements: React.ReactNode[] = [];
  const xVals = data.map(d => String(d.x));

  // Reference lines
  template.referenceLines?.forEach(ref => {
    const resolvedVal = ref.sourceCol && row ? (row[ref.sourceCol] ?? ref.value) : ref.value;
    if (ref.axis === 'y') {
      const val = Number(resolvedVal);
      if (resolvedVal === '' || isNaN(val)) return;
      elements.push(
        <RechartRefLine key={ref.id} yAxisId="left" y={val}
          ifOverflow="extendDomain"
          stroke={ref.color || 'hsl(var(--destructive))'} strokeDasharray="4 4"
          label={{ value: ref.label || String(resolvedVal), position: 'insideTopRight', fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
      );
    } else {
      if (!resolvedVal) return;
      elements.push(
        <RechartRefLine key={ref.id} yAxisId="left" x={String(resolvedVal)}
          stroke={ref.color || 'hsl(var(--destructive))'} strokeDasharray="4 4"
          label={{ value: ref.label || String(resolvedVal), position: 'insideTopLeft', fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
      );
    }
  });

  // Reference areas
  template.referenceAreas?.forEach(area => {
    const resolvedFrom = area.fromSourceCol && row ? (row[area.fromSourceCol] ?? area.from) : area.from;
    const resolvedTo = area.toSourceCol && row ? (row[area.toSourceCol] ?? area.to) : area.to;
    if (area.axis === 'y') {
      const from = Number(resolvedFrom), to = Number(resolvedTo);
      if (isNaN(from) || isNaN(to)) return;
      elements.push(
        <RechartRefArea key={area.id} yAxisId="left" y1={from} y2={to}
          ifOverflow="hidden"
          fill={area.color || 'hsl(var(--primary))'} fillOpacity={0.08}
          label={area.label ? { value: area.label, position: 'insideTopLeft', fontSize: 10, fill: 'hsl(var(--muted-foreground))' } : undefined} />
      );
    } else {
      if (!area.from && !area.to) return;
      const fromStr = String(resolvedFrom || '');
      const toStr = String(resolvedTo || '');
      if (xVals.length === 0) return;
      const first = xVals[0], last = xVals[xVals.length - 1];
      const x1 = !fromStr ? first : (fromStr < first ? first : (fromStr > last ? null : (xVals.includes(fromStr) ? fromStr : xVals.find(v => v >= fromStr) || last)));
      const x2 = !toStr ? last : (toStr > last ? last : (toStr < first ? null : (xVals.includes(toStr) ? toStr : [...xVals].reverse().find(v => v <= toStr) || first)));
      if (x1 === null || x2 === null) return;
      elements.push(
        <RechartRefArea key={area.id} yAxisId="left" x1={x1} x2={x2}
          fill={area.color || 'hsl(var(--primary))'} fillOpacity={0.08}
          label={area.label ? { value: area.label, position: 'insideTopLeft', fontSize: 10, fill: 'hsl(var(--muted-foreground))' } : undefined} />
      );
    }
  });

  return elements;
}

// ── Build Categorical Overlay Areas ─────────────────

export function buildCategoricalOverlays(
  row: Record<string, unknown>,
  template: ChartTemplate,
  globalCatColorMap?: Record<string, string>,
): React.ReactNode[] {
  let segs = buildCatSegments(row, template, globalCatColorMap);
  if (template.visibleCategories && template.visibleCategories.length > 0) {
    segs = segs.filter(s => template.visibleCategories!.includes(s.category));
  }
  const opacity = template.categoryOpacity ?? 0.15;
  return segs.map((seg, si) => (
    <RechartRefArea key={`cat_${si}`} yAxisId="left" x1={seg.fromX} x2={seg.toX}
      fill={seg.color} fillOpacity={opacity}
      label={{ value: seg.category, position: 'insideTop', fontSize: 9, fill: seg.color }} />
  ));
}

// ── Build Categorical Legend Items ──────────────────

export function buildCategoryLegendItems(
  row: Record<string, unknown>,
  template: ChartTemplate,
  globalCatColorMap?: Record<string, string>,
): { category: string; color: string; col: string }[] {
  if (!template.categoricalCols?.length) return [];
  const items: { category: string; color: string; col: string }[] = [];
  template.categoricalCols.forEach(col => {
    const vals = parseListValue(row[col]);
    if (!vals) return;
    const strVals = vals.map(String);
    const colorMap = globalCatColorMap ?? buildCategoryColorMap(strVals);
    const presentCats = new Set(strVals.filter(Boolean));
    presentCats.forEach(cat => {
      if (!items.find(i => i.category === cat)) {
        items.push({ category: cat, color: colorMap[cat] || '#888', col });
      }
    });
  });
  return items;
}

// ── SHAP Explanation Areas ──────────────────────────

export interface ShapAreasResult {
  xVals: string[];
  posAreas: { key: string; label: string; values: number[] }[];
  negAreas: { key: string; label: string; values: number[] }[];
}

/**
 * Compute SHAP stacked area data for a row.
 * If explanationCols/shapTopK are provided (from a saved template), use those;
 * otherwise show all explanation cols individually.
 */
export function buildShapAreas(
  row: Record<string, unknown>,
  fieldConfig: FieldConfig | null,
  explanationCols?: string[],
  shapTopK?: number | null,
): ShapAreasResult | null {
  if (!row || !fieldConfig?.prediction) return null;
  const availableCols = fieldConfig.prediction.explanationCols ?? [];
  const selectedCols = explanationCols ?? availableCols;
  if (availableCols.length === 0 || selectedCols.length === 0) return null;

  const predTimepoint = fieldConfig.prediction.timepoint;
  if (!predTimepoint) return null;
  const xVals = parseListValue(row[predTimepoint]);
  if (!xVals || xVals.length === 0) return null;

  const allFeatures: { col: string; values: number[] }[] = [];
  for (const col of availableCols) {
    const vals = parseListValue(row[col]);
    if (!vals) continue;
    allFeatures.push({ col, values: vals.map(Number) });
  }
  if (allFeatures.length === 0) return null;

  let showIndividually: { col: string; values: number[] }[];
  if (shapTopK != null && shapTopK > 0 && shapTopK < selectedCols.length) {
    const ranked = selectedCols
      .map(col => allFeatures.find(f => f.col === col))
      .filter(Boolean) as { col: string; values: number[] }[];
    ranked.sort((a, b) => b.values.reduce((s, v) => s + Math.abs(v), 0) - a.values.reduce((s, v) => s + Math.abs(v), 0));
    showIndividually = ranked.slice(0, shapTopK);
  } else {
    showIndividually = selectedCols
      .map(col => allFeatures.find(f => f.col === col))
      .filter(Boolean) as { col: string; values: number[] }[];
  }

  const showSet = new Set(showIndividually.map(f => f.col));
  const othersFeatures = allFeatures.filter(f => !showSet.has(f.col));
  const othersValues = xVals.map((_, i) =>
    othersFeatures.reduce((sum, f) => sum + (f.values[i] ?? 0), 0)
  );
  const hasOthers = othersFeatures.length > 0 && othersValues.some(v => v !== 0);

  const posAreas: { key: string; label: string; values: number[] }[] = [];
  const negAreas: { key: string; label: string; values: number[] }[] = [];

  for (const f of showIndividually) {
    const posVals = f.values.map(v => Math.max(0, v));
    const negVals = f.values.map(v => Math.min(0, v));
    if (posVals.some(v => v > 0)) posAreas.push({ key: `shap_pos_${f.col}`, label: f.col, values: posVals });
    if (negVals.some(v => v < 0)) negAreas.push({ key: `shap_neg_${f.col}`, label: f.col, values: negVals });
  }
  if (hasOthers) {
    const posVals = othersValues.map(v => Math.max(0, v));
    const negVals = othersValues.map(v => Math.min(0, v));
    if (posVals.some(v => v > 0)) posAreas.push({ key: 'shap_pos_Others', label: 'Others', values: posVals });
    if (negVals.some(v => v < 0)) negAreas.push({ key: 'shap_neg_Others', label: 'Others', values: negVals });
  }

  return { xVals: xVals.map(String), posAreas, negAreas };
}

/**
 * Merge SHAP area data into existing chart data points.
 */
export function mergeShapIntoChartData(
  baseData: Record<string, unknown>[],
  shapAreas: ShapAreasResult,
): Record<string, unknown>[] {
  const shapByX = new Map<string, Record<string, number>>();
  for (let i = 0; i < shapAreas.xVals.length; i++) {
    const x = shapAreas.xVals[i];
    const point: Record<string, number> = {};
    for (const a of shapAreas.posAreas) point[a.key] = a.values[i] ?? 0;
    for (const a of shapAreas.negAreas) point[a.key] = a.values[i] ?? 0;
    shapByX.set(x, point);
  }
  return baseData.map(d => {
    const x = String(d.x);
    const shapPoint = shapByX.get(x);
    return shapPoint ? { ...d, ...shapPoint } : d;
  });
}

const BLUE_SHADES = ['#1E5EB1', '#3B82F6', '#60A5FA', '#93C5FD', '#BFDBFE', '#2563EB', '#1D4ED8', '#1E40AF'];
const RED_SHADES = ['#DC2626', '#EF4444', '#F87171', '#FCA5A5', '#FECACA', '#B91C1C', '#991B1B', '#7F1D1D'];

/**
 * Build SHAP Area React elements for rendering inside a ComposedChart.
 */
export function buildShapAreaElements(shapAreas: ShapAreasResult): React.ReactNode[] {
  const elements: React.ReactNode[] = [];
  shapAreas.posAreas.forEach((a, i) => {
    elements.push(
      <Area key={a.key} type="monotone" dataKey={a.key} stackId="shap_pos"
        yAxisId="left" name={a.label}
        fill={a.label === 'Others' ? '#94A3B8' : BLUE_SHADES[i % BLUE_SHADES.length]}
        stroke={a.label === 'Others' ? '#94A3B8' : BLUE_SHADES[i % BLUE_SHADES.length]}
        fillOpacity={a.label === 'Others' ? 0.3 : 0.6} strokeWidth={0} />
    );
  });
  shapAreas.negAreas.forEach((a, i) => {
    elements.push(
      <Area key={a.key} type="monotone" dataKey={a.key} stackId="shap_neg"
        yAxisId="left" name={`${a.label} (−)`}
        fill={a.label === 'Others' ? '#94A3B8' : RED_SHADES[i % RED_SHADES.length]}
        stroke={a.label === 'Others' ? '#94A3B8' : RED_SHADES[i % RED_SHADES.length]}
        fillOpacity={a.label === 'Others' ? 0.3 : 0.6} strokeWidth={0} />
    );
  });
  return elements;
}
