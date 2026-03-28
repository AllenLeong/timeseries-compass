import Papa from 'papaparse';

export interface ColumnInfo {
  name: string;
  type: 'scalar' | 'list_num' | 'list_str' | 'url';
  sampleValues: string[];
}

export interface FieldConfig {
  version: string;
  columns: {
    index: string[];
    name: string;
    attributes: string[];
    image: string;
    timeseries: string[];
    categoricalTimeseries: string[];
    timepoint: string;
    timepoint_priority: string;
  };
  prediction?: PredictionConfig;
  templates: ChartTemplate[];
  created_at: string;
  updated_at?: string;
}

export type YAxisFormat = 'raw' | 'thousands' | 'percent' | 'fixed2' | 'fixed4';
export type SmoothMethod = 'none' | 'moving_avg' | 'exponential' | 'savitzky_golay';
export type RollingType = 'mean' | 'std' | 'min' | 'max';
export type AccumulativeType = 'none' | 'sum' | 'avg';
export type LineStyle = 'solid' | 'dashed' | 'dotted' | 'dash-dot';

export interface ReferenceLine {
  id: string;
  axis: 'x' | 'y';
  value: number | string;
  label?: string;
  color?: string;
  sourceCol?: string;
}

export interface ReferenceAreaConfig {
  id: string;
  axis: 'x' | 'y';
  from: number | string;
  to: number | string;
  label?: string;
  color?: string;
  fromSourceCol?: string;
  toSourceCol?: string;
}

/** Per-series display configuration */
export interface SeriesDisplayConfig {
  showRaw: boolean;
  smooth: SmoothMethod;
  smoothWindow: number;
  rolling?: RollingType;
  rollingWindow: number;
  accumulative: AccumulativeType;
  color?: string;
  opacity?: number;
  lineStyle?: LineStyle;
}

export interface FillAreaConfig {
  id: string;
  series1: string;
  series2: string;
  color?: string;
  opacity?: number;
}

export interface ChartTemplate {
  id: string;
  name: string;
  xAxis: string;
  yAxisLeft: string[];
  yAxisRight: string[];
  yAxisLeftFormat?: YAxisFormat;
  yAxisRightFormat?: YAxisFormat;
  seriesConfig?: Record<string, SeriesDisplayConfig>;
  referenceLines?: ReferenceLine[];
  referenceAreas?: ReferenceAreaConfig[];
  fillAreas?: FillAreaConfig[];
  categoricalCols?: string[];
  categoryOpacity?: number;
  visibleCategories?: string[];
  stacked?: boolean;
}

export interface PredictionMapping {
  predictionCol: string;
  actualCol: string;
  upperBoundCol?: string;
  lowerBoundCol?: string;
}

export interface PredictionConfig {
  timepoint: string;
  timepointLabels?: string;
  predictions: PredictionMapping[];
  explanationCols: string[];
}

export interface ParsedData {
  headers: string[];
  rows: Record<string, unknown>[];
  columnInfo: ColumnInfo[];
}

function detectColumnType(values: string[]): 'scalar' | 'list_num' | 'list_str' | 'url' {
  const nonEmpty = values.filter(v => v != null && String(v).trim() !== '');
  if (nonEmpty.length === 0) return 'scalar';
  
  const urlPattern = /^https?:\/\//i;
  const listPattern = /^\[.*\]$/s;
  
  let urlCount = 0;
  let listCount = 0;
  
  for (const v of nonEmpty.slice(0, 20)) {
    const s = String(v).trim();
    if (urlPattern.test(s)) urlCount++;
    if (listPattern.test(s)) listCount++;
  }
  
  const threshold = nonEmpty.slice(0, 20).length * 0.5;
  if (urlCount > threshold) return 'url';
  if (listCount > threshold) {
    // Determine if list contains numbers or strings
    for (const v of nonEmpty.slice(0, 5)) {
      const parsed = parseListValue(v);
      if (parsed && parsed.length > 0) {
        // If first element is a string (not a number), it's list_str
        if (typeof parsed[0] === 'string' && isNaN(Number(parsed[0]))) return 'list_str';
      }
    }
    return 'list_num';
  }
  return 'scalar';
}

export function parseListValue(value: unknown): number[] | string[] | null {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s.startsWith('[') || !s.endsWith(']')) return null;
  
  try {
    // Handle Python-style lists with single quotes
    const jsonStr = s.replace(/'/g, '"');
    const parsed = JSON.parse(jsonStr);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // Try manual parsing for edge cases
    try {
      const inner = s.slice(1, -1).trim();
      if (!inner) return [];
      const items = inner.split(',').map(item => {
        const trimmed = item.trim().replace(/^['"]|['"]$/g, '');
        const num = Number(trimmed);
        return isNaN(num) ? trimmed : num;
      });
      return items as number[] | string[];
    } catch {
      return null;
    }
  }
  return null;
}

export function parseCSV(file: File): Promise<ParsedData> {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false,
      complete: (results) => {
        const headers = results.meta.fields || [];
        const rows = results.data as Record<string, unknown>[];
        
        const columnInfo: ColumnInfo[] = headers.map(header => {
          const sampleValues = rows.slice(0, 20).map(r => String(r[header] ?? ''));
          return {
            name: header,
            type: detectColumnType(sampleValues),
            sampleValues: sampleValues.slice(0, 5),
          };
        });
        
        resolve({ headers, rows, columnInfo });
      },
      error: (error) => reject(error),
    });
  });
}

export function autoDetectConfig(columnInfo: ColumnInfo[]): Partial<FieldConfig['columns']> {
  const scalars = columnInfo.filter(c => c.type === 'scalar');
  const listNums = columnInfo.filter(c => c.type === 'list_num');
  const listStrs = columnInfo.filter(c => c.type === 'list_str');
  const urls = columnInfo.filter(c => c.type === 'url');
  
  const allLists = [...listNums, ...listStrs];
  
  // Guess index: first scalar column
  const indexCols = scalars.length > 0 ? [scalars[0].name] : [];
  const nameCols = scalars.length > 0 ? scalars[0].name : '';
  const attrCols = scalars.slice(1).map(c => c.name);
  const imageCols = urls.length > 0 ? urls[0].name : '';
  
  const dateKeywords = ['date', 'time', 'idx', 'index', 'timestamp'];
  // timeseries: only numeric lists, excluding date-like
  const timeseriesCols = listNums
    .filter(c => !dateKeywords.some(kw => c.name.toLowerCase().includes(kw)))
    .map(c => c.name);
  // categorical timeseries: string lists
  const categoricalCols = listStrs.map(c => c.name);
  // timepoint: first list (num or str) that looks like date/index
  const timepointCol = allLists.find(c => 
    dateKeywords.some(kw => c.name.toLowerCase().includes(kw))
  )?.name || '';
  
  return {
    index: indexCols,
    name: nameCols,
    attributes: attrCols,
    image: imageCols,
    timeseries: timeseriesCols,
    categoricalTimeseries: categoricalCols,
    timepoint: timepointCol,
    timepoint_priority: timepointCol,
  };
}
