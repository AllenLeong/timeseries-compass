import React, { useState, useMemo } from 'react';
import { format, parse, isValid } from 'date-fns';
import { useDataStore } from '@/lib/data-store';
import { parseListValue } from '@/lib/csv-parser';
import type { ChartTemplate, ReferenceLine, ReferenceAreaConfig, YAxisFormat, SmoothMethod, AccumulativeType, SeriesDisplayConfig, FillAreaConfig, LineStyle } from '@/lib/csv-parser';
import {
  CURVE_COLORS, formatYValue,
  Y_FORMAT_OPTIONS, SMOOTH_OPTIONS, DEFAULT_SERIES_CONFIG, LINE_STYLE_OPTIONS, getStrokeDasharray,
  buildCategoryColorMap, buildGlobalCategoryColorMap, CATEGORY_COLORS,
} from '@/lib/curve-utils';
import {
  buildChartData, buildChartLines, buildReferenceElements,
  buildCategoryLegendItems, buildCatSegments, getPredColSet,
  buildShapAreas, mergeShapIntoChartData, buildShapAreaElements,
} from '@/lib/chart-builder';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Slider } from '@/components/ui/slider';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { CalendarIcon, Save, Trash2, Edit2, Plus, X, ChevronDown, ChevronRight, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import { toast } from 'sonner';

/* ── Date detection helpers ──────────────────────── */
const DATE_PATTERNS = [
  /^\d{4}-\d{2}-\d{2}$/,            // 2024-01-15
  /^\d{4}\/\d{2}\/\d{2}$/,          // 2024/01/15
  /^\d{2}-\d{2}-\d{4}$/,            // 01-15-2024
  /^\d{2}\/\d{2}\/\d{4}$/,          // 01/15/2024
  /^\d{4}-\d{2}-\d{2}[T ]\d{2}:/,   // datetime
];

function looksLikeDateValues(values: string[]): boolean {
  if (values.length === 0) return false;
  const sample = values.slice(0, Math.min(5, values.length));
  return sample.every(v => DATE_PATTERNS.some(p => p.test(v.trim())));
}

function parseDateString(s: string): Date | undefined {
  if (!s) return undefined;
  const d = new Date(s);
  if (isValid(d)) return d;
  return undefined;
}

function formatDateForAxis(date: Date, sample: string): string {
  // Match the format of existing axis values
  if (/^\d{4}-\d{2}-\d{2}$/.test(sample)) return format(date, 'yyyy-MM-dd');
  if (/^\d{4}\/\d{2}\/\d{2}$/.test(sample)) return format(date, 'yyyy/MM/dd');
  if (/^\d{2}-\d{2}-\d{4}$/.test(sample)) return format(date, 'MM-dd-yyyy');
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(sample)) return format(date, 'MM/dd/yyyy');
  return format(date, 'yyyy-MM-dd');
}

/* ── Date picker input for ref lines/areas ───────── */
function DateInput({ value, onChange, sample, placeholder, defaultDate }: {
  value: string; onChange: (v: string) => void; sample: string; placeholder?: string; defaultDate?: string;
}) {
  const date = parseDateString(value);
  const initialMonth = date ?? parseDateString(defaultDate ?? '') ?? undefined;
  const [editing, setEditing] = React.useState(false);
  return (
    <div className="flex-1 flex gap-0.5">
      {editing ? (
        <Input
          autoFocus
          defaultValue={value}
          className="h-7 text-xs font-mono flex-1"
          placeholder={placeholder}
          onBlur={e => { onChange(e.target.value); setEditing(false); }}
          onKeyDown={e => { if (e.key === 'Enter') { onChange((e.target as HTMLInputElement).value); setEditing(false); } }}
        />
      ) : (
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className={cn("h-7 text-xs flex-1 justify-start font-mono gap-1", !value && "text-muted-foreground")}
              onDoubleClick={(e) => { e.preventDefault(); setEditing(true); }}>
              <CalendarIcon className="h-3 w-3" />
              {value || placeholder || 'Pick date'}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start" avoidCollisions={false} sideOffset={4}>
            <Calendar
              mode="single"
              selected={date}
              defaultMonth={initialMonth}
              fixedWeeks
              onSelect={(d) => { if (d) onChange(formatDateForAxis(d, sample)); }}
              className="p-3 pointer-events-auto"
            />
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

/* ── Clamp X reference area bounds to data range ─── */
function clampXRefArea(from: string, to: string, xValues: string[]): { x1: string; x2: string } | null {
  if (!from && !to) return null;
  if (xValues.length === 0) return null;
  const first = xValues[0];
  const last = xValues[xValues.length - 1];
  // Clamp: if from is before data, use first; if to is after data, use last
  const x1 = !from ? first : (from < first ? first : (from > last ? null : from));
  const x2 = !to ? last : (to > last ? last : (to < first ? null : to));
  if (x1 === null || x2 === null) return null;
  // Ensure x1 snaps to nearest existing value if not exact match
  const snap = (v: string) => {
    if (xValues.includes(v)) return v;
    // Find nearest value
    for (let i = 0; i < xValues.length; i++) {
      if (xValues[i] >= v) return xValues[i];
    }
    return last;
  };
  return { x1: snap(x1), x2: snap(x2) };
}
import {
  ComposedChart, AreaChart, Line, Area, XAxis, YAxis, Tooltip, Legend,
  ResponsiveContainer, CartesianGrid,
  ReferenceLine as RechartRefLine,
  ReferenceArea as RechartRefArea,
} from 'recharts';

/* ── Field helper ─────────────────────────────────── */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs font-medium text-muted-foreground block mb-1">{label}</label>
      {children}
    </div>
  );
}

/* ── Per-series config widget ─────────────────────── */
function SeriesConfigWidget({
  col, config, color, onChange,
}: {
  col: string; config: SeriesDisplayConfig; color: string;
  onChange: (cfg: SeriesDisplayConfig) => void;
}) {
  const [open, setOpen] = useState(false);
  const [hexInput, setHexInput] = useState(config.color || '');

  return (
    <div className="glass-panel px-2.5 py-1.5 text-xs space-y-1.5">
      <button
        className="flex items-center gap-2 w-full text-left"
        onClick={() => setOpen(!open)}
      >
        <div className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: config.color || color }} />
        <span className="font-mono font-medium flex-1 truncate">{col}</span>
        {open ? <ChevronDown className="h-3 w-3 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
      </button>

      {open && (
        <div className="pl-5 space-y-2 pt-1 border-t border-border/50">
          {/* Raw toggle */}
          <label className="flex items-center gap-2 cursor-pointer">
            <Checkbox
              checked={config.showRaw}
              onCheckedChange={v => onChange({ ...config, showRaw: !!v })}
              className="h-3.5 w-3.5"
            />
            <span>Original</span>
          </label>

          {/* Smoothing */}
          <div className="space-y-1">
            <span className="text-muted-foreground">Smoothing</span>
            <div className="flex gap-1.5">
              <Select value={config.smooth} onValueChange={v => onChange({ ...config, smooth: v as SmoothMethod })}>
                <SelectTrigger className="h-6 text-[11px] flex-1"><SelectValue /></SelectTrigger>
                <SelectContent>{SMOOTH_OPTIONS.map(o => (
                  <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
                ))}</SelectContent>
              </Select>
              {config.smooth !== 'none' && (
                <Input type="number" min={2} max={50} value={config.smoothWindow}
                  onChange={e => onChange({ ...config, smoothWindow: Number(e.target.value) })}
                  className="h-6 text-[11px] w-12" />
              )}
            </div>
          </div>

          {/* Rolling */}
          <div className="space-y-1">
            <span className="text-muted-foreground">Rolling</span>
            <div className="flex gap-1.5">
              <Select value={config.rolling ?? 'none'} onValueChange={v => onChange({ ...config, rolling: v === 'none' ? undefined : v as any })}>
                <SelectTrigger className="h-6 text-[11px] flex-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none" className="text-xs">None</SelectItem>
                  <SelectItem value="mean" className="text-xs">Mean</SelectItem>
                  <SelectItem value="std" className="text-xs">Std Dev</SelectItem>
                  <SelectItem value="min" className="text-xs">Min</SelectItem>
                  <SelectItem value="max" className="text-xs">Max</SelectItem>
                </SelectContent>
              </Select>
              {config.rolling && (
                <Input type="number" min={2} max={50} value={config.rollingWindow}
                  onChange={e => onChange({ ...config, rollingWindow: Number(e.target.value) })}
                  className="h-6 text-[11px] w-12" />
              )}
            </div>
          </div>

          {/* Accumulative */}
          <div className="space-y-1">
            <span className="text-muted-foreground">Accumulative</span>
            <Select value={config.accumulative ?? 'none'} onValueChange={v => onChange({ ...config, accumulative: v as AccumulativeType })}>
              <SelectTrigger className="h-6 text-[11px] flex-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none" className="text-xs">None</SelectItem>
                <SelectItem value="sum" className="text-xs">Cumulative Sum</SelectItem>
                <SelectItem value="avg" className="text-xs">Cumulative Avg</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Line Style */}
          <div className="space-y-1">
            <span className="text-muted-foreground">Line Style</span>
            <Select value={config.lineStyle ?? 'solid'} onValueChange={v => onChange({ ...config, lineStyle: v as LineStyle })}>
              <SelectTrigger className="h-6 text-[11px] flex-1"><SelectValue /></SelectTrigger>
              <SelectContent>{LINE_STYLE_OPTIONS.map(o => (
                <SelectItem key={o.value} value={o.value} className="text-xs font-mono">{o.label}</SelectItem>
              ))}</SelectContent>
            </Select>
          </div>

          {/* Color */}
          <div className="space-y-1">
            <span className="text-muted-foreground">Color</span>
            <div className="flex flex-wrap gap-1 items-center">
              {CURVE_COLORS.slice(0, 8).map(c => (
                <button key={c}
                  className={cn("w-4 h-4 rounded-sm border transition-all", config.color === c ? "ring-2 ring-primary ring-offset-1" : "border-border/50")}
                  style={{ backgroundColor: c }}
                  onClick={() => { onChange({ ...config, color: c }); setHexInput(c); }}
                />
              ))}
              <button
                className={cn("w-4 h-4 rounded-sm border border-dashed border-border/50 text-[8px] flex items-center justify-center", !config.color && "ring-2 ring-primary ring-offset-1")}
                onClick={() => { onChange({ ...config, color: undefined }); setHexInput(''); }}
                title="Auto"
              >A</button>
            </div>
            <div className="flex gap-1 items-center mt-1">
              <Input
                value={hexInput}
                onChange={e => setHexInput(e.target.value)}
                onBlur={() => {
                  const v = hexInput.trim();
                  if (/^#[0-9a-fA-F]{3,8}$/.test(v)) {
                    onChange({ ...config, color: v });
                  } else if (!v) {
                    onChange({ ...config, color: undefined });
                  }
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    const v = hexInput.trim();
                    if (/^#[0-9a-fA-F]{3,8}$/.test(v)) {
                      onChange({ ...config, color: v });
                    }
                  }
                }}
                placeholder="#hex"
                className="h-6 text-[11px] w-20 font-mono"
              />
              {config.color && (
                <div className="w-4 h-4 rounded-sm border border-border/50" style={{ backgroundColor: config.color }} />
              )}
            </div>
          </div>

          {/* Opacity */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Opacity</span>
              <span className="text-[10px] font-mono text-muted-foreground">{Math.round((config.opacity ?? 1) * 100)}%</span>
            </div>
            <Slider
              min={10} max={100} step={5}
              value={[Math.round((config.opacity ?? 1) * 100)]}
              onValueChange={([v]) => onChange({ ...config, opacity: v / 100 })}
              className="w-full"
            />
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Searchable Product Picker ────────────────────── */
function ProductSearch({ rows, nameCol, indexCols, value, onChange }: {
  rows: Record<string, unknown>[];
  nameCol: string;
  indexCols: string[];
  value: number;
  onChange: (idx: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return rows.slice(0, 500).map((r, i) => ({
      idx: i,
      name: String(r[nameCol] ?? `#${i}`),
      ids: indexCols.map(c => String(r[c] ?? '')),
    })).filter(p => !q || p.name.toLowerCase().includes(q) || p.ids.some(id => id.toLowerCase().includes(q)));
  }, [rows, nameCol, indexCols, query]);

  const currentName = String(rows[value]?.[nameCol] ?? `#${value}`);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs font-mono text-left flex items-center justify-between"
      >
        <span className="truncate">{currentName}{indexCols.length > 0 && ` (${indexCols.map(c => String(rows[value]?.[c] ?? '')).join(', ')})`}</span>
        <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-9 z-50 rounded-lg border bg-popover shadow-lg max-h-[260px] flex flex-col">
          <div className="p-1.5 border-b">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground/50" />
              <Input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search products..."
                className="h-7 pl-7 text-xs"
                autoFocus
              />
            </div>
          </div>
          <div className="overflow-auto flex-1">
            {filtered.slice(0, 100).map(p => (
              <button
                key={p.idx}
                className={cn(
                  'w-full text-left px-3 py-1.5 text-xs font-mono hover:bg-secondary/60 transition-colors',
                  p.idx === value && 'bg-primary/10 text-primary font-semibold'
                )}
                onClick={() => { onChange(p.idx); setOpen(false); setQuery(''); }}
              >
                <span>{p.name}</span>
                {p.ids.length > 0 && <span className="ml-1 text-muted-foreground">({p.ids.join(', ')})</span>}
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="px-3 py-4 text-xs text-muted-foreground text-center">No results</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── State ────────────────────────────────────────── */
interface TemplateState {
  name: string;
  xAxis: string;
  yLeft: string[];
  yRight: string[];
  yLeftFormat: YAxisFormat;
  yRightFormat: YAxisFormat;
  seriesConfig: Record<string, SeriesDisplayConfig>;
  referenceLines: ReferenceLine[];
  referenceAreas: ReferenceAreaConfig[];
  fillAreas: FillAreaConfig[];
  categoricalCols: string[];
  categoryOpacity: number;
  visibleCategories: string[];
  editingId: string | null;
  stacked: boolean;
  explanationCols: string[];
  shapTopK: number | null;
}

type TemplateAction =
  | { type: 'SET'; field: string; value: any }
  | { type: 'SET_SERIES_CONFIG'; col: string; config: SeriesDisplayConfig }
  | { type: 'RESET' }
  | { type: 'LOAD'; template: ChartTemplate };

const initialState: TemplateState = {
  name: '', xAxis: '', yLeft: [], yRight: [],
  yLeftFormat: 'raw', yRightFormat: 'raw',
  seriesConfig: {}, referenceLines: [], referenceAreas: [], fillAreas: [],
  categoricalCols: [], categoryOpacity: 0.15, visibleCategories: [],
  editingId: null, stacked: false,
  explanationCols: [], shapTopK: null,
};

function reducer(state: TemplateState, action: TemplateAction): TemplateState {
  switch (action.type) {
    case 'SET': return { ...state, [action.field]: action.value };
    case 'SET_SERIES_CONFIG':
      return { ...state, seriesConfig: { ...state.seriesConfig, [action.col]: action.config } };
    case 'RESET': return initialState;
    case 'LOAD': {
      const t = action.template;
      return {
        name: t.name, xAxis: t.xAxis,
        yLeft: t.yAxisLeft, yRight: t.yAxisRight,
        yLeftFormat: t.yAxisLeftFormat ?? 'raw',
        yRightFormat: t.yAxisRightFormat ?? 'raw',
        seriesConfig: t.seriesConfig ?? {},
        referenceLines: t.referenceLines ?? [],
        referenceAreas: t.referenceAreas ?? [],
        fillAreas: t.fillAreas ?? [],
        categoricalCols: t.categoricalCols ?? [],
        categoryOpacity: t.categoryOpacity ?? 0.15,
        visibleCategories: t.visibleCategories ?? [],
        editingId: t.id,
        stacked: t.stacked ?? false,
        explanationCols: (t as any).explanationCols ?? [],
        shapTopK: (t as any).shapTopK ?? null,
      };
    }
    default: return state;
  }
}

/* ── Main Page ────────────────────────────────────── */
export default function CurvesPage() {
  const { parsedData, fieldConfig, templates, addTemplate, updateTemplate, deleteTemplate } = useDataStore();
  const [state, dispatch] = React.useReducer(reducer, initialState);
  const [previewProduct, setPreviewProduct] = useState(0);

  const listCols = fieldConfig?.columns.timeseries ?? [];
  const catCols = fieldConfig?.columns.categoricalTimeseries ?? [];

  const globalCatColorMap = useMemo(() => {
    if (!parsedData || catCols.length === 0) return {};
    return buildGlobalCategoryColorMap(parsedData.rows, catCols);
  }, [parsedData, catCols]);

  // Auto-set X axis to configured timepoint
  React.useEffect(() => {
    if (fieldConfig?.columns.timepoint && !state.xAxis) {
      dispatch({ type: 'SET', field: 'xAxis', value: fieldConfig.columns.timepoint });
    }
  }, [fieldConfig, state.xAxis]);

  // Prediction-related columns for Y axis
  const predRelatedCols = useMemo(() => {
    if (!fieldConfig?.prediction) return [];
    const cols: string[] = [];
    for (const m of fieldConfig.prediction.predictions) {
      if (m.predictionCol && !cols.includes(m.predictionCol)) cols.push(m.predictionCol);
      if (m.upperBoundCol && !cols.includes(m.upperBoundCol)) cols.push(m.upperBoundCol);
      if (m.lowerBoundCol && !cols.includes(m.lowerBoundCol)) cols.push(m.lowerBoundCol);
    }
    return cols;
  }, [fieldConfig]);

  // Set of prediction column names (use pred.timepoint for x)
  const predColSet = useMemo(() => new Set(predRelatedCols), [predRelatedCols]);

  // Scalar columns for reference line/area column picker
  const scalarCols = useMemo(() =>
    parsedData?.columnInfo.filter(c => c.type === 'scalar').map(c => c.name) ?? [],
    [parsedData]
  );

  // Get X axis values for reference line picker
  const xAxisValues = useMemo(() => {
    if (!parsedData || !state.xAxis) return [];
    const row = parsedData.rows[previewProduct];
    if (!row) return [];
    const vals = parseListValue(row[state.xAxis]);
    return vals ? vals.map(String) : [];
  }, [parsedData, state.xAxis, previewProduct]);

  const isDateXAxis = useMemo(() => looksLikeDateValues(xAxisValues), [xAxisValues]);
  const dateSample = xAxisValues[0] ?? 'yyyy-MM-dd';

  /** Build a virtual ChartTemplate from current state for shared functions */
  const stateAsTemplate = useMemo((): ChartTemplate => ({
    id: state.editingId || '__preview__',
    name: state.name,
    xAxis: state.xAxis,
    yAxisLeft: state.yLeft,
    yAxisRight: state.yRight,
    yAxisLeftFormat: state.yLeftFormat,
    yAxisRightFormat: state.yRightFormat,
    seriesConfig: state.seriesConfig,
    referenceLines: state.referenceLines,
    referenceAreas: state.referenceAreas,
    fillAreas: state.fillAreas,
    categoricalCols: state.categoricalCols,
    categoryOpacity: state.categoryOpacity,
    visibleCategories: state.visibleCategories,
    stacked: state.stacked,
  }), [state]);

  const row = parsedData?.rows[previewProduct];
  const allYCols = [...state.yLeft, ...state.yRight];

  // Get or create series config for a column
  const getSeriesConfig = (col: string): SeriesDisplayConfig =>
    state.seriesConfig[col] ?? { ...DEFAULT_SERIES_CONFIG };

  // Build chart data using shared module
  // Available explanation columns from field config
  const availableExplanationCols = fieldConfig?.prediction?.explanationCols ?? [];

  // SHAP: use shared utility
  const shapAreas = useMemo(() => {
    if (state.explanationCols.length === 0) return null;
    return buildShapAreas(row, fieldConfig, state.explanationCols, state.shapTopK);
  }, [row, fieldConfig, state.explanationCols, state.shapTopK]);

  // Merge SHAP data into chart data
  const chartData = useMemo(() => {
    const baseData = buildChartData({
      row,
      template: stateAsTemplate,
      fieldConfig,
      enablePrediction: allYCols.some(c => predColSet.has(c)),
    });
    if (!shapAreas || baseData.length === 0) return baseData;
    return mergeShapIntoChartData(baseData, shapAreas);
  }, [row, stateAsTemplate, fieldConfig, predColSet, shapAreas]);

  // Build categorical segments and legend using shared module
  const categoricalSegments = useMemo(() => {
    if (!row) return [];
    const segs = buildCatSegments(row, stateAsTemplate, globalCatColorMap);
    if (state.visibleCategories.length > 0) {
      return segs.filter(seg => state.visibleCategories.includes(seg.category));
    }
    return segs;
  }, [row, stateAsTemplate, state.visibleCategories]);

  const categoryLegend = useMemo(() => {
    if (!row) return [];
    return buildCategoryLegendItems(row, stateAsTemplate, globalCatColorMap);
  }, [row, stateAsTemplate]);

  // All unique category values across the ENTIRE dataset for the filter picker
  const allCategoryValues = useMemo(() => {
    if (!parsedData || state.categoricalCols.length === 0) return [];
    const values = new Set<string>();
    for (const r of parsedData.rows) {
      for (const col of state.categoricalCols) {
        const vals = parseListValue(r[col]);
        if (!vals) continue;
        vals.map(String).filter(v => v.trim() !== '').forEach(v => values.add(v));
      }
    }
    return [...values].sort();
  }, [parsedData, state.categoricalCols]);

  /** Build all Line/Area elements using shared module */
  const lineElements = useMemo(() => buildChartLines({
    template: stateAsTemplate,
    fieldConfig,
    row,
  }), [stateAsTemplate, fieldConfig, row]);


  if (!parsedData || !fieldConfig) {
    return <div className="flex items-center justify-center h-full text-muted-foreground text-sm">No data loaded.</div>;
  }

  const handleSave = () => {
    if (!state.name.trim()) { toast.error('Enter a template name'); return; }
    const template: ChartTemplate & { explanationCols?: string[]; shapTopK?: number | null } = {
      id: state.editingId || crypto.randomUUID(),
      name: state.name.trim(), xAxis: state.xAxis,
      yAxisLeft: state.yLeft, yAxisRight: state.yRight,
      yAxisLeftFormat: state.yLeftFormat, yAxisRightFormat: state.yRightFormat,
      seriesConfig: state.seriesConfig,
      referenceLines: state.referenceLines,
      referenceAreas: state.referenceAreas,
      fillAreas: state.fillAreas,
      categoricalCols: state.categoricalCols,
      categoryOpacity: state.categoryOpacity,
      visibleCategories: state.visibleCategories,
      stacked: state.stacked,
      explanationCols: state.explanationCols,
      shapTopK: state.shapTopK,
    };
    if (state.editingId) {
      updateTemplate(state.editingId, template);
      toast.success('Template updated');
    } else {
      addTemplate(template);
      toast.success('Template saved');
    }
    dispatch({ type: 'RESET' });
  };

  const toggleCol = (col: string, list: string[], field: 'yLeft' | 'yRight') => {
    const newList = list.includes(col) ? list.filter(c => c !== col) : [...list, col];
    dispatch({ type: 'SET', field, value: newList });
    if (!list.includes(col) && !state.seriesConfig[col]) {
      dispatch({ type: 'SET_SERIES_CONFIG', col, config: { ...DEFAULT_SERIES_CONFIG } });
    }
  };

  const addRefLine = () => {
    dispatch({ type: 'SET', field: 'referenceLines', value: [...state.referenceLines, { id: crypto.randomUUID(), axis: 'y', value: '' }] });
  };
  const updateRefLine = (id: string, partial: Partial<ReferenceLine>) => {
    dispatch({ type: 'SET', field: 'referenceLines', value: state.referenceLines.map(r => r.id === id ? { ...r, ...partial } : r) });
  };
  const removeRefLine = (id: string) => {
    dispatch({ type: 'SET', field: 'referenceLines', value: state.referenceLines.filter(r => r.id !== id) });
  };

  const addRefArea = () => {
    dispatch({ type: 'SET', field: 'referenceAreas', value: [...state.referenceAreas, { id: crypto.randomUUID(), axis: 'y', from: '', to: '' }] });
  };
  const updateRefArea = (id: string, partial: Partial<ReferenceAreaConfig>) => {
    dispatch({ type: 'SET', field: 'referenceAreas', value: state.referenceAreas.map(r => r.id === id ? { ...r, ...partial } : r) });
  };
  const removeRefArea = (id: string) => {
    dispatch({ type: 'SET', field: 'referenceAreas', value: state.referenceAreas.filter(r => r.id !== id) });
  };

  const addFillArea = () => {
    dispatch({ type: 'SET', field: 'fillAreas', value: [...state.fillAreas, { id: crypto.randomUUID(), series1: '', series2: '', color: '#1E5EB1', opacity: 0.15 }] });
  };
  const updateFillArea = (id: string, partial: Partial<FillAreaConfig>) => {
    dispatch({ type: 'SET', field: 'fillAreas', value: state.fillAreas.map(a => a.id === id ? { ...a, ...partial } : a) });
  };
  const removeFillArea = (id: string) => {
    dispatch({ type: 'SET', field: 'fillAreas', value: state.fillAreas.filter(a => a.id !== id) });
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }} className="h-[calc(100vh-3rem)] flex">
      {/* ── Left Config Panel — Liquid Glass ── */}
      <div className="w-[380px] overflow-auto p-4 space-y-4 shrink-0"
        style={{
          background: 'hsl(var(--glass-bg))',
          backdropFilter: 'blur(var(--glass-blur)) saturate(var(--glass-saturate))',
          borderRight: '0.5px solid hsl(var(--glass-border-subtle))',
        }}
      >
        <h2 className="text-sm font-semibold">Custom Curve Builder</h2>

        <Field label="Template Name">
          <Input value={state.name} onChange={e => dispatch({ type: 'SET', field: 'name', value: e.target.value })}
            placeholder="My Chart" className="h-8 text-xs" />
        </Field>

        {/* X Axis — auto-selected from config */}
        <Field label="X Axis (Timepoint)">
          <div className="flex flex-wrap gap-1.5">
            {fieldConfig.columns.timepoint && (
              <Badge variant="default" className="text-xs font-mono">{fieldConfig.columns.timepoint}</Badge>
            )}
            {fieldConfig.prediction?.timepoint && fieldConfig.prediction.timepoint !== fieldConfig.columns.timepoint && (
              <Badge variant="secondary" className="text-xs font-mono opacity-70">{fieldConfig.prediction.timepoint} (pred)</Badge>
            )}
            {!fieldConfig.columns.timepoint && (
              <p className="text-xs text-muted-foreground italic">No timepoint configured</p>
            )}
          </div>
        </Field>

        {/* Y Left */}
        <Field label="Y Axis Left">
          <div className="flex flex-wrap gap-1">
            {listCols.map(col => (
              <Badge key={col} variant={state.yLeft.includes(col) ? 'default' : 'outline'}
                className={cn('cursor-pointer text-xs font-mono', state.yRight.includes(col) && 'opacity-40')}
                onClick={() => !state.yRight.includes(col) && toggleCol(col, state.yLeft, 'yLeft')}>{col}</Badge>
            ))}
          </div>
          {predRelatedCols.length > 0 && (
            <div className="mt-1.5">
              <span className="text-[10px] text-muted-foreground/70 uppercase tracking-wider">Prediction</span>
              <div className="flex flex-wrap gap-1 mt-0.5">
                {predRelatedCols.map(col => (
                  <Badge key={col} variant={state.yLeft.includes(col) ? 'default' : 'outline'}
                    className={cn('cursor-pointer text-xs font-mono border-destructive/30', state.yRight.includes(col) && 'opacity-40')}
                    onClick={() => !state.yRight.includes(col) && toggleCol(col, state.yLeft, 'yLeft')}>{col}</Badge>
                ))}
              </div>
            </div>
          )}
          <Select value={state.yLeftFormat} onValueChange={v => dispatch({ type: 'SET', field: 'yLeftFormat', value: v })}>
            <SelectTrigger className="h-7 text-xs mt-1 w-32"><SelectValue placeholder="Format" /></SelectTrigger>
            <SelectContent>{Y_FORMAT_OPTIONS.map(o => <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>)}</SelectContent>
          </Select>
        </Field>

        {/* Y Right */}
        <Field label="Y Axis Right (optional)">
          <div className="flex flex-wrap gap-1">
            {listCols.map(col => (
              <Badge key={col} variant={state.yRight.includes(col) ? 'default' : 'outline'}
                className={cn('cursor-pointer text-xs font-mono', state.yLeft.includes(col) && 'opacity-40')}
                onClick={() => !state.yLeft.includes(col) && toggleCol(col, state.yRight, 'yRight')}>{col}</Badge>
            ))}
          </div>
          {predRelatedCols.length > 0 && (
            <div className="mt-1.5">
              <span className="text-[10px] text-muted-foreground/70 uppercase tracking-wider">Prediction</span>
              <div className="flex flex-wrap gap-1 mt-0.5">
                {predRelatedCols.map(col => (
                  <Badge key={col} variant={state.yRight.includes(col) ? 'default' : 'outline'}
                    className={cn('cursor-pointer text-xs font-mono border-destructive/30', state.yLeft.includes(col) && 'opacity-40')}
                    onClick={() => !state.yLeft.includes(col) && toggleCol(col, state.yRight, 'yRight')}>{col}</Badge>
                ))}
              </div>
            </div>
          )}
          <Select value={state.yRightFormat} onValueChange={v => dispatch({ type: 'SET', field: 'yRightFormat', value: v })}>
            <SelectTrigger className="h-7 text-xs mt-1 w-32"><SelectValue placeholder="Format" /></SelectTrigger>
            <SelectContent>{Y_FORMAT_OPTIONS.map(o => <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>)}</SelectContent>
          </Select>
        </Field>

        {/* Stacked toggle */}
        {allYCols.length > 1 && (
          <label className="flex items-center gap-2 cursor-pointer">
            <Checkbox
              checked={state.stacked}
              onCheckedChange={v => dispatch({ type: 'SET', field: 'stacked', value: !!v })}
              className="h-3.5 w-3.5"
            />
            <span className="text-xs font-medium text-foreground/80">Stack Series</span>
          </label>
        )}

        {/* SHAP Explanation Columns — dropdown multi-select */}
        {availableExplanationCols.length > 0 && (
          <Field label="SHAP Explanation">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full h-8 text-xs justify-between font-mono">
                  <span className="truncate">
                    {state.explanationCols.length === 0
                      ? 'Select features...'
                      : `${state.explanationCols.length} feature${state.explanationCols.length > 1 ? 's' : ''} selected`}
                  </span>
                  <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[340px] p-0 max-h-[300px] overflow-auto" align="start">
                <div className="p-2 border-b">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">{state.explanationCols.length}/{availableExplanationCols.length}</span>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" className="h-5 text-[10px] px-1.5"
                        onClick={() => dispatch({ type: 'SET', field: 'explanationCols', value: [...availableExplanationCols] })}>All</Button>
                      <Button variant="ghost" size="sm" className="h-5 text-[10px] px-1.5"
                        onClick={() => dispatch({ type: 'SET', field: 'explanationCols', value: [] })}>None</Button>
                    </div>
                  </div>
                </div>
                {availableExplanationCols.map(col => (
                  <label key={col} className="flex items-center gap-2 px-3 py-1.5 hover:bg-secondary/40 cursor-pointer text-xs font-mono">
                    <Checkbox
                      checked={state.explanationCols.includes(col)}
                      onCheckedChange={() => {
                        const newCols = state.explanationCols.includes(col)
                          ? state.explanationCols.filter(c => c !== col)
                          : [...state.explanationCols, col];
                        dispatch({ type: 'SET', field: 'explanationCols', value: newCols });
                      }}
                      className="h-3.5 w-3.5"
                    />
                    <span className="truncate">{col}</span>
                  </label>
                ))}
              </PopoverContent>
            </Popover>
            {state.explanationCols.length > 1 && (
              <div className="mt-2 space-y-1">
                <label className="flex items-center gap-2 cursor-pointer">
                  <Checkbox
                    checked={state.shapTopK != null}
                    onCheckedChange={v => dispatch({ type: 'SET', field: 'shapTopK', value: v ? Math.min(5, state.explanationCols.length) : null })}
                    className="h-3.5 w-3.5"
                  />
                  <span className="text-xs text-foreground/80">Show Top K (abs sum)</span>
                </label>
                {state.shapTopK != null && (
                  <div className="flex items-center gap-2 pl-5">
                    <span className="text-xs text-muted-foreground">K =</span>
                    <Input type="number" min={1} max={state.explanationCols.length}
                      value={state.shapTopK}
                      onChange={e => dispatch({ type: 'SET', field: 'shapTopK', value: Math.max(1, Number(e.target.value)) })}
                      className="h-6 text-[11px] w-14" />
                    <span className="text-[10px] text-muted-foreground">rest → Others</span>
                  </div>
                )}
              </div>
            )}
          </Field>
        )}

        {catCols.length > 0 && (
          <Field label="Categorical Overlays (list[str])">
            <div className="flex flex-wrap gap-1">
              {catCols.map(col => (
                <Badge key={col}
                  variant={state.categoricalCols.includes(col) ? 'default' : 'outline'}
                  className="cursor-pointer text-xs font-mono"
                  onClick={() => {
                    const newCols = state.categoricalCols.includes(col)
                      ? state.categoricalCols.filter(c => c !== col)
                      : [...state.categoricalCols, col];
                    dispatch({ type: 'SET', field: 'categoricalCols', value: newCols });
                  }}>{col}</Badge>
              ))}
            </div>
          </Field>
        )}

        {/* Per-series display config */}
        {(allYCols.length > 0 || state.categoricalCols.length > 0) && (
          <Field label="Series Display">
            <div className="space-y-1.5">
              {allYCols.map((col, i) => (
                <SeriesConfigWidget
                  key={col}
                  col={col}
                  color={CURVE_COLORS[i % CURVE_COLORS.length]}
                  config={getSeriesConfig(col)}
                  onChange={cfg => dispatch({ type: 'SET_SERIES_CONFIG', col, config: cfg })}
                />
              ))}
              {/* Categorical overlay settings */}
              {state.categoricalCols.length > 0 && (
                <div className="glass-panel px-2.5 py-2 text-xs space-y-2">
                  <span className="font-medium text-foreground/80">Categorical Overlays</span>
                  {/* Opacity slider */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Opacity</span>
                      <span className="text-[10px] font-mono text-muted-foreground">{Math.round(state.categoryOpacity * 100)}%</span>
                    </div>
                    <Slider
                      min={5} max={80} step={5}
                      value={[Math.round(state.categoryOpacity * 100)]}
                      onValueChange={([v]) => dispatch({ type: 'SET', field: 'categoryOpacity', value: v / 100 })}
                      className="w-full"
                    />
                  </div>
                  {/* Category value filter */}
                  {allCategoryValues.length > 0 && (
                    <div className="space-y-1">
                      <span className="text-[11px] text-foreground/70 font-medium">Show Categories {state.visibleCategories.length > 0 ? `(${state.visibleCategories.length}/${allCategoryValues.length})` : '(all)'}</span>
                      <div className="flex flex-wrap gap-1">
                        {allCategoryValues.map(cat => {
                          const colorMap = globalCatColorMap;
                          const isVisible = state.visibleCategories.length === 0 || state.visibleCategories.includes(cat);
                          return (
                            <Badge key={cat}
                              variant={isVisible ? 'default' : 'outline'}
                              className="cursor-pointer text-[10px] gap-1"
                              style={isVisible ? { backgroundColor: colorMap[cat], borderColor: colorMap[cat] } : {}}
                              onClick={() => {
                                let newVisible: string[];
                                if (state.visibleCategories.length === 0) {
                                  newVisible = allCategoryValues.filter(c => c !== cat);
                                } else if (state.visibleCategories.includes(cat)) {
                                  newVisible = state.visibleCategories.filter(c => c !== cat);
                                  if (newVisible.length === 0) newVisible = [];
                                } else {
                                  newVisible = [...state.visibleCategories, cat];
                                }
                                if (newVisible.length === allCategoryValues.length) newVisible = [];
                                dispatch({ type: 'SET', field: 'visibleCategories', value: newVisible });
                              }}
                            >{cat}</Badge>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </Field>
        )}

        {/* Reference Lines */}
        <Field label="Reference Lines">
          <div className="space-y-1.5">
            {state.referenceLines.map(ref => (
              <div key={ref.id} className="space-y-1">
                <div className="flex items-center gap-1.5">
                  <Select value={ref.axis} onValueChange={v => updateRefLine(ref.id, { axis: v as 'x' | 'y' })}>
                    <SelectTrigger className="h-7 text-xs w-14"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="y" className="text-xs">Y</SelectItem>
                      <SelectItem value="x" className="text-xs">X</SelectItem>
                    </SelectContent>
                  </Select>
                  {ref.sourceCol ? (
                    <span className="h-7 flex items-center text-xs font-mono text-muted-foreground flex-1 truncate px-1">
                      ← {ref.sourceCol}
                    </span>
                  ) : ref.axis === 'x' ? (
                    isDateXAxis ? (
                      <DateInput value={String(ref.value)} onChange={v => updateRefLine(ref.id, { value: v })} sample={dateSample} defaultDate={dateSample} placeholder="Select date" />
                    ) : (
                      <Input value={String(ref.value)} className="h-7 text-xs flex-1 font-mono"
                        onChange={e => updateRefLine(ref.id, { value: e.target.value })} placeholder="X value" />
                    )
                  ) : (
                    <Input value={String(ref.value)} className="h-7 text-xs flex-1"
                      onChange={e => updateRefLine(ref.id, { value: e.target.value })} placeholder="Value" />
                  )}
                  <Input value={ref.label ?? ''} className="h-7 text-xs w-20"
                    onChange={e => updateRefLine(ref.id, { label: e.target.value })} placeholder="Label" />
                  <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => removeRefLine(ref.id)}>
                    <X className="h-3 w-3" />
                  </Button>
                </div>
                <div className="flex items-center gap-1.5 pl-[60px]">
                  <Select value={ref.sourceCol ?? '__none__'} onValueChange={v => updateRefLine(ref.id, { sourceCol: v === '__none__' ? undefined : v, value: v === '__none__' ? ref.value : '' })}>
                    <SelectTrigger className="h-6 text-[11px] flex-1"><SelectValue placeholder="From column…" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__" className="text-xs">Manual value</SelectItem>
                      {scalarCols.map(c => <SelectItem key={c} value={c} className="text-xs font-mono">{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Input value={ref.color ?? ''} className="h-6 text-[11px] w-20 font-mono"
                    onChange={e => updateRefLine(ref.id, { color: e.target.value })} placeholder="#color" />
                </div>
              </div>
            ))}
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1 w-full" onClick={addRefLine}>
              <Plus className="h-3 w-3" /> Add Line
            </Button>
          </div>
        </Field>

        {/* Reference Areas */}
        <Field label="Reference Areas">
          <div className="space-y-1.5">
            {state.referenceAreas.map(area => (
              <div key={area.id} className="space-y-1">
                <div className="flex items-center gap-1.5">
                  <Select value={area.axis} onValueChange={v => updateRefArea(area.id, { axis: v as 'x' | 'y' })}>
                    <SelectTrigger className="h-7 text-xs w-14"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="y" className="text-xs">Y</SelectItem>
                      <SelectItem value="x" className="text-xs">X</SelectItem>
                    </SelectContent>
                  </Select>
                  {area.fromSourceCol ? (
                    <span className="h-7 flex items-center text-xs font-mono text-muted-foreground flex-1 truncate px-1">← {area.fromSourceCol}</span>
                  ) : area.axis === 'x' ? (
                    isDateXAxis ? (
                      <DateInput value={String(area.from)} onChange={v => updateRefArea(area.id, { from: v })} sample={dateSample} defaultDate={dateSample} placeholder="From" />
                    ) : (
                      <Input value={String(area.from)} className="h-7 text-xs flex-1 font-mono"
                        onChange={e => updateRefArea(area.id, { from: e.target.value })} placeholder="From" />
                    )
                  ) : (
                    <Input value={String(area.from)} className="h-7 text-xs flex-1"
                      onChange={e => updateRefArea(area.id, { from: e.target.value })} placeholder="From" />
                  )}
                  {area.toSourceCol ? (
                    <span className="h-7 flex items-center text-xs font-mono text-muted-foreground flex-1 truncate px-1">← {area.toSourceCol}</span>
                  ) : area.axis === 'x' ? (
                    isDateXAxis ? (
                      <DateInput value={String(area.to)} onChange={v => updateRefArea(area.id, { to: v })} sample={dateSample} defaultDate={dateSample} placeholder="To" />
                    ) : (
                      <Input value={String(area.to)} className="h-7 text-xs flex-1 font-mono"
                        onChange={e => updateRefArea(area.id, { to: e.target.value })} placeholder="To" />
                    )
                  ) : (
                    <Input value={String(area.to)} className="h-7 text-xs flex-1"
                      onChange={e => updateRefArea(area.id, { to: e.target.value })} placeholder="To" />
                  )}
                  <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => removeRefArea(area.id)}>
                    <X className="h-3 w-3" />
                  </Button>
                </div>
                <div className="flex items-center gap-1.5 pl-[60px]">
                  <Select value={area.fromSourceCol ?? '__none__'} onValueChange={v => updateRefArea(area.id, { fromSourceCol: v === '__none__' ? undefined : v, from: v === '__none__' ? area.from : '' })}>
                    <SelectTrigger className="h-6 text-[11px] flex-1"><SelectValue placeholder="From col" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__" className="text-xs">Manual</SelectItem>
                      {scalarCols.map(c => <SelectItem key={c} value={c} className="text-xs font-mono">{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={area.toSourceCol ?? '__none__'} onValueChange={v => updateRefArea(area.id, { toSourceCol: v === '__none__' ? undefined : v, to: v === '__none__' ? area.to : '' })}>
                    <SelectTrigger className="h-6 text-[11px] flex-1"><SelectValue placeholder="To col" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__" className="text-xs">Manual</SelectItem>
                      {scalarCols.map(c => <SelectItem key={c} value={c} className="text-xs font-mono">{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Input value={area.label ?? ''} className="h-6 text-[11px] w-16"
                    onChange={e => updateRefArea(area.id, { label: e.target.value })} placeholder="Label" />
                  <Input value={area.color ?? ''} className="h-6 text-[11px] w-16 font-mono"
                    onChange={e => updateRefArea(area.id, { color: e.target.value })} placeholder="#color" />
                </div>
              </div>
            ))}
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1 w-full" onClick={addRefArea}>
              <Plus className="h-3 w-3" /> Add Area
            </Button>
          </div>
        </Field>

        {/* Fill Areas — highlight between two series */}
        {allYCols.length >= 2 && (
          <Field label="Fill Areas (between series)">
            <div className="space-y-1.5">
              {state.fillAreas.map(fa => (
                <div key={fa.id} className="glass-panel px-2.5 py-2 text-xs space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <Select value={fa.series1 || '__pick__'} onValueChange={v => v !== '__pick__' && updateFillArea(fa.id, { series1: v })}>
                      <SelectTrigger className="h-7 text-xs flex-1"><SelectValue placeholder="Series 1" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__pick__" className="text-xs text-muted-foreground" disabled>Pick…</SelectItem>
                        {allYCols.map(col => <SelectItem key={col} value={col} className="text-xs font-mono">{col}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <span className="text-muted-foreground shrink-0">↔</span>
                    <Select value={fa.series2 || '__pick__'} onValueChange={v => v !== '__pick__' && updateFillArea(fa.id, { series2: v })}>
                      <SelectTrigger className="h-7 text-xs flex-1"><SelectValue placeholder="Series 2" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__pick__" className="text-xs text-muted-foreground" disabled>Pick…</SelectItem>
                        {allYCols.map(col => <SelectItem key={col} value={col} className="text-xs font-mono">{col}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => removeFillArea(fa.id)}>
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-muted-foreground shrink-0">Color</span>
                    <div className="flex gap-1">
                      {['#1E5EB1', '#34d399', '#f59e42', '#e879a8', '#6366f1'].map(c => (
                        <button key={c}
                          className={cn("w-3.5 h-3.5 rounded-sm border transition-all", fa.color === c ? "ring-2 ring-primary ring-offset-1" : "border-border/50")}
                          style={{ backgroundColor: c }}
                          onClick={() => updateFillArea(fa.id, { color: c })}
                        />
                      ))}
                    </div>
                    <Input value={fa.color ?? ''} className="h-6 text-[11px] w-[70px] font-mono"
                      onChange={e => updateFillArea(fa.id, { color: e.target.value })} placeholder="#hex" />
                    <span className="text-muted-foreground shrink-0 ml-1">α</span>
                    <Slider
                      min={5} max={80} step={5}
                      value={[Math.round((fa.opacity ?? 0.15) * 100)]}
                      onValueChange={([v]) => updateFillArea(fa.id, { opacity: v / 100 })}
                      className="flex-1 min-w-[60px]"
                    />
                    <span className="text-[10px] font-mono text-muted-foreground w-8">{Math.round((fa.opacity ?? 0.15) * 100)}%</span>
                  </div>
                </div>
              ))}
              <Button variant="outline" size="sm" className="h-7 text-xs gap-1 w-full" onClick={addFillArea}>
                <Plus className="h-3 w-3" /> Add Fill Area
              </Button>
            </div>
          </Field>
        )}

        {/* Preview Product — searchable */}
        <Field label="Preview Product">
          <ProductSearch
            rows={parsedData.rows}
            nameCol={fieldConfig.columns.name}
            indexCols={fieldConfig.columns.index}
            value={previewProduct}
            onChange={setPreviewProduct}
          />
        </Field>

        <Button onClick={handleSave} className="w-full h-8 text-xs gap-1.5"
          disabled={!state.name || !state.xAxis || allYCols.length === 0}>
          <Save className="h-3 w-3" /> {state.editingId ? 'Update Template' : 'Save Template'}
        </Button>

        {/* Saved templates */}
        {templates.length > 0 && (
          <Field label="Saved Templates">
            <div className="space-y-1">
              {templates.map(t => (
                <div key={t.id} className="glass-panel px-3 py-2 flex items-center justify-between text-xs">
                  <div>
                    <span className="font-medium">{t.name}</span>
                    <span className="text-muted-foreground ml-2">{t.yAxisLeft.length + t.yAxisRight.length} series</span>
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" className="h-6 w-6"
                      onClick={() => dispatch({ type: 'LOAD', template: t })}><Edit2 className="h-3 w-3" /></Button>
                    <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive"
                      onClick={() => { deleteTemplate(t.id); toast.success('Deleted'); }}><Trash2 className="h-3 w-3" /></Button>
                  </div>
                </div>
              ))}
            </div>
          </Field>
        )}
      </div>

      {/* ── Right Chart Preview ── */}
      <div className="flex-1 p-4 overflow-auto">
        <h3 className="text-sm font-medium mb-3">Chart Preview</h3>
        {chartData.length > 0 ? (
          <div className="glass-panel p-4">
            <ResponsiveContainer width="100%" height={420}>
              {(() => {
                const ChartComponent = state.stacked ? AreaChart : ComposedChart;
                return (
                <ChartComponent data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="x"
                  tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                  interval={Math.max(0, Math.floor(chartData.length / 10))} />
                <YAxis yAxisId="left" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                  tickFormatter={v => formatYValue(v, state.yLeftFormat)} />
                {state.yRight.length > 0 && (
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                    tickFormatter={v => formatYValue(v, state.yRightFormat)} />
                )}
                <Tooltip contentStyle={{
                  backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))',
                  borderRadius: '6px', fontSize: '12px',
                }} />
                <Legend wrapperStyle={{ fontSize: '11px' }} />
                {lineElements}
                {shapAreas && buildShapAreaElements(shapAreas)}
                {buildReferenceElements(stateAsTemplate, chartData, row)}
                {categoricalSegments.map((seg, i) => (
                  <RechartRefArea key={`cat_${i}`} yAxisId="left" x1={seg.fromX} x2={seg.toX}
                    fill={seg.color} fillOpacity={state.categoryOpacity}
                    label={{ value: seg.category, position: 'insideTop', fontSize: 9, fill: seg.color }} />
                ))}
                </ChartComponent>
                );
              })()}
            </ResponsiveContainer>
            {/* Categorical legend */}
            {categoryLegend.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2 px-2">
                {categoryLegend.map((item, i) => (
                  <div key={i} className="flex items-center gap-1.5 text-[11px]">
                    <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: item.color, opacity: 0.5 }} />
                    <span className="text-muted-foreground">{item.col}:</span>
                    <span className="font-mono">{item.category}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="glass-panel p-12 flex items-center justify-center text-muted-foreground text-sm">
            Select X axis and at least one Y axis to preview
          </div>
        )}
      </div>
    </motion.div>
  );
}
