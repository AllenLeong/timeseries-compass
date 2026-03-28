import type { YAxisFormat, SmoothMethod, AccumulativeType, SeriesDisplayConfig, LineStyle } from './csv-parser';

// ── Y-Axis Formatting ──────────────────────────────
export const Y_FORMAT_OPTIONS: { value: YAxisFormat; label: string }[] = [
  { value: 'raw', label: 'Raw' },
  { value: 'thousands', label: '1,000' },
  { value: 'percent', label: '%' },
  { value: 'fixed2', label: '0.00' },
  { value: 'fixed4', label: '0.0000' },
];

export function formatYValue(v: number, fmt: YAxisFormat): string {
  switch (fmt) {
    case 'thousands': return v.toLocaleString();
    case 'percent': return `${(v * 100).toFixed(1)}%`;
    case 'fixed2': return v.toFixed(2);
    case 'fixed4': return v.toFixed(4);
    default: return String(v);
  }
}

// ── Smoothing Algorithms ────────────────────────────
export const SMOOTH_OPTIONS: { value: SmoothMethod; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'moving_avg', label: 'Moving Avg' },
  { value: 'exponential', label: 'Exponential' },
  { value: 'savitzky_golay', label: 'Savitzky-Golay' },
];

export const LINE_STYLE_OPTIONS: { value: LineStyle; label: string }[] = [
  { value: 'solid', label: '── Solid' },
  { value: 'dashed', label: '╌╌ Dashed' },
  { value: 'dotted', label: '··· Dotted' },
  { value: 'dash-dot', label: '─·─ Dash-Dot' },
];

export function getStrokeDasharray(style?: LineStyle): string | undefined {
  switch (style) {
    case 'dashed': return '6 4';
    case 'dotted': return '2 3';
    case 'dash-dot': return '8 3 2 3';
    default: return undefined;
  }
}

export function applySmoothing(data: number[], method: SmoothMethod, window: number): number[] {
  if (method === 'none' || data.length === 0) return data;
  const w = Math.max(2, Math.min(window, data.length));
  switch (method) {
    case 'moving_avg': return movingAverage(data, w);
    case 'exponential': return exponentialSmoothing(data, 2 / (w + 1));
    case 'savitzky_golay': return savitzkyGolay(data, w);
    default: return data;
  }
}

function movingAverage(data: number[], w: number): number[] {
  const half = Math.floor(w / 2);
  return data.map((_, i) => {
    const start = Math.max(0, i - half);
    const end = Math.min(data.length, i + half + 1);
    const slice = data.slice(start, end);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });
}

function exponentialSmoothing(data: number[], alpha: number): number[] {
  const result = [data[0]];
  for (let i = 1; i < data.length; i++) {
    result.push(alpha * data[i] + (1 - alpha) * result[i - 1]);
  }
  return result;
}

function savitzkyGolay(data: number[], w: number): number[] {
  const half = Math.floor(w / 2);
  return data.map((_, i) => {
    const start = Math.max(0, i - half);
    const end = Math.min(data.length, i + half + 1);
    const slice = data.slice(start, end);
    const n = slice.length;
    const mid = (n - 1) / 2;
    let sumW = 0, sumWV = 0;
    slice.forEach((v, j) => {
      const dist = Math.abs(j - mid);
      const weight = 1 - (dist / (mid + 1)) ** 2;
      sumW += weight;
      sumWV += weight * v;
    });
    return sumWV / sumW;
  });
}

// ── Rolling Statistics ──────────────────────────────
export function applyRolling(data: number[], window: number, type: 'mean' | 'std' | 'min' | 'max'): number[] {
  const half = Math.floor(window / 2);
  return data.map((_, i) => {
    const start = Math.max(0, i - half);
    const end = Math.min(data.length, i + half + 1);
    const slice = data.slice(start, end);
    switch (type) {
      case 'mean': return slice.reduce((a, b) => a + b, 0) / slice.length;
      case 'std': {
        const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
        const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / slice.length;
        return Math.sqrt(variance);
      }
      case 'min': return Math.min(...slice);
      case 'max': return Math.max(...slice);
    }
  });
}

// ── Accumulative Transforms ─────────────────────────
export function applyAccumulative(data: number[], type: AccumulativeType): number[] {
  if (type === 'none') return data;
  const result: number[] = [];
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum += data[i];
    result.push(type === 'sum' ? sum : sum / (i + 1));
  }
  return result;
}


export const DEFAULT_SERIES_CONFIG: SeriesDisplayConfig = {
  showRaw: true,
  smooth: 'none',
  smoothWindow: 5,
  rolling: undefined,
  rollingWindow: 5,
  accumulative: 'none',
  color: undefined,
  opacity: 1,
  lineStyle: 'solid',
};

// ── Chart Colors — #1E5EB1 blue dominant with balanced spectrum ───
export const CURVE_COLORS = [
  '#1E5EB1', // brand blue
  '#4C3AB8', // brand accent violet
  '#34d399', // emerald
  '#f59e42', // warm amber
  '#38bdf8', // bright cyan
  '#e879a8', // rose pink
  '#2dd4bf', // teal
  '#f97316', // tangerine
  '#6366f1', // indigo
  '#84cc16', // lime
  '#fb7185', // coral
  '#06b6d4', // cyan
];

// ── Categorical Area Colors — softer, theme-harmonious ───
export const CATEGORY_COLORS = [
  '#5a8fd4', // soft brand blue
  '#7b6bc4', // soft accent violet
  '#34d399', // emerald-400
  '#fbbf24', // amber-400
  '#22d3ee', // cyan-400
  '#f472b6', // pink-400
  '#2dd4bf', // teal-400
  '#fb923c', // orange-400
  '#60a5fa', // blue-400
  '#a3e635', // lime-400
  '#fb7185', // rose-400
  '#a78bfa', // purple-400
];

/** Build categorical segments from list[str] data for rendering as colored areas */
export interface CategoricalSegment {
  col: string;
  category: string;
  fromX: string;
  toX: string;
  color: string;
}

export function buildCategoricalSegments(
  xValues: string[],
  catValues: string[],
  col: string,
  colorMap: Record<string, string>,
): CategoricalSegment[] {
  if (!catValues.length || catValues.length !== xValues.length) return [];
  const segments: CategoricalSegment[] = [];
  let currentCat = catValues[0];
  let startIdx = 0;

  for (let i = 1; i <= catValues.length; i++) {
    if (i === catValues.length || catValues[i] !== currentCat) {
      if (currentCat && currentCat.trim() !== '') {
        segments.push({
          col,
          category: currentCat,
          fromX: xValues[startIdx],
          toX: xValues[Math.min(i, xValues.length - 1)],
          color: colorMap[currentCat] || CATEGORY_COLORS[0],
        });
      }
      if (i < catValues.length) {
        currentCat = catValues[i];
        startIdx = i;
      }
    }
  }
  return segments;
}

/** Build a global color map across ALL rows for given categorical columns */
export function buildGlobalCategoryColorMap(
  rows: Record<string, unknown>[],
  catCols: string[],
): Record<string, string> {
  const allCats: string[] = [];
  for (const row of rows) {
    for (const col of catCols) {
      const raw = row[col];
      if (raw == null) continue;
      const vals = typeof raw === 'string' ? parseCatList(raw) : Array.isArray(raw) ? raw.map(String) : null;
      if (vals) allCats.push(...vals);
    }
  }
  return buildCategoryColorMap(allCats);
}

function parseCatList(s: string): string[] | null {
  const trimmed = s.trim();
  if (!trimmed.startsWith('[')) return null;
  try {
    const inner = trimmed.slice(1, -1);
    return inner.split(',').map(v => v.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  } catch { return null; }
}

/** Assign colors to unique categories — None/empty defaults to gray */
export function buildCategoryColorMap(categories: string[]): Record<string, string> {
  const unique = [...new Set(categories.filter(Boolean))];
  const map: Record<string, string> = {};
  const NONE_KEYWORDS = ['none', 'null', 'n/a', 'na', '-', ''];
  let colorIdx = 0;
  unique.forEach((cat) => {
    if (NONE_KEYWORDS.includes(cat.toLowerCase().trim())) {
      map[cat] = '#9ca3af'; // gray-400
    } else {
      map[cat] = CATEGORY_COLORS[colorIdx % CATEGORY_COLORS.length];
      colorIdx++;
    }
  });
  return map;
}
