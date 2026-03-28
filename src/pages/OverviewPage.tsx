import { useMemo, useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDataStore } from '@/lib/data-store';
import type { ColumnFilter } from '@/lib/data-store';
import { parseListValue } from '@/lib/csv-parser';
import { CURVE_COLORS, buildGlobalCategoryColorMap } from '@/lib/curve-utils';
import { MiniCategoricalChart } from '@/components/MiniCategoricalChart';
import {
  Search, Filter, ChevronUp, ChevronDown, X, Columns3,
  ChevronLeft, ChevronRight, Sparkles, ArrowUpDown, Download
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { MiniSparkline } from '@/components/MiniSparkline';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';

// Generate stable colors for attributes
const ATTR_COLORS = [
  'bg-primary/10 text-primary border-primary/15',
  'bg-accent/60 text-accent-foreground border-accent-foreground/15',
  'bg-chart-2/10 text-chart-2 border-chart-2/15',
  'bg-chart-3/10 text-chart-3 border-chart-3/15',
  'bg-chart-4/10 text-chart-4 border-chart-4/15',
  'bg-chart-5/10 text-chart-5 border-chart-5/15',
  'bg-primary/8 text-primary/80 border-primary/12',
  'bg-accent/40 text-accent-foreground/80 border-accent-foreground/12',
];

/** Compute stats for a numeric list */
function computeListStats(values: number[]) {
  if (!values.length) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const std = Math.sqrt(values.reduce((s, v) => s + (v - avg) ** 2, 0) / values.length);
  return { min, max, avg, std };
}

/** Check if attribute column is numeric */
function isNumericAttribute(rows: Record<string, unknown>[], col: string): boolean {
  let numCount = 0;
  let total = 0;
  for (const row of rows.slice(0, 50)) {
    const v = String(row[col] ?? '').trim();
    if (!v) continue;
    total++;
    if (!isNaN(Number(v))) numCount++;
  }
  return total > 0 && numCount / total > 0.8;
}

/** Get unique values for a column */
function getUniqueValues(rows: Record<string, unknown>[], col: string): string[] {
  const set = new Set<string>();
  for (const row of rows) {
    const v = String(row[col] ?? '').trim();
    if (v) set.add(v);
  }
  return Array.from(set).sort();
}

/** Get unique values from categorical list columns */
function getUniqueCatListValues(rows: Record<string, unknown>[], col: string): string[] {
  const set = new Set<string>();
  for (const row of rows) {
    const parsed = parseListValue(row[col]);
    if (parsed) {
      for (const v of parsed) {
        const s = String(v).trim();
        if (s && !['none', 'null', 'n/a', '-', ''].includes(s.toLowerCase())) {
          set.add(s);
        }
      }
    }
  }
  return Array.from(set).sort();
}

/** Get numeric range for an attribute column */
function getNumericRange(rows: Record<string, unknown>[], col: string): { min: number; max: number } {
  let min = Infinity, max = -Infinity;
  for (const row of rows) {
    const n = Number(row[col]);
    if (!isNaN(n)) { min = Math.min(min, n); max = Math.max(max, n); }
  }
  return { min: min === Infinity ? 0 : min, max: max === -Infinity ? 0 : max };
}

/** Get stat range across all rows for a timeseries column */
function getTsStatRange(rows: Record<string, unknown>[], col: string, stat: 'min' | 'max' | 'avg' | 'std'): { min: number; max: number } {
  let rMin = Infinity, rMax = -Infinity;
  for (const row of rows.slice(0, 200)) {
    const parsed = parseListValue(row[col]);
    if (!parsed) continue;
    const nums = parsed.map(Number).filter(n => !isNaN(n));
    const s = computeListStats(nums);
    if (!s) continue;
    const v = s[stat];
    rMin = Math.min(rMin, v);
    rMax = Math.max(rMax, v);
  }
  return { min: rMin === Infinity ? 0 : rMin, max: rMax === -Infinity ? 0 : rMax };
}

function getFilterLabel(f: ColumnFilter, getColLabel: (c: string) => string): string {
  const label = getColLabel(f.col);
  if (f.type === 'text') return `${label}: ${f.value}`;
  if (f.type === 'multiselect') return `${label}: ${f.values.join(', ')}`;
  if (f.type === 'range') {
    const parts: string[] = [];
    if (f.min != null) parts.push(`≥${f.min}`);
    if (f.max != null) parts.push(`≤${f.max}`);
    return `${label}: ${parts.join(' ')}`;
  }
  return label;
}

export default function OverviewPage() {
  const navigate = useNavigate();
  const { parsedData, fieldConfig, setSelectedProduct, viewState, setOverviewCols, setOverviewSearch, setOverviewSort, setOverviewFilters, exportConfig } = useDataStore();
  const search = viewState.overviewSearch;
  const sortCol = viewState.overviewSortCol;
  const sortDir = viewState.overviewSortDir;
  const columnFilters = viewState.overviewColumnFilters;
  const [page, setPage] = useState(0);
  const [activeFilterCol, setActiveFilterCol] = useState<string | null>(null);
  const [filterInput, setFilterInput] = useState('');
  const pageSize = 50;

  const rawSelectedExtraCols = viewState.overviewSelectedCols;
  const setSelectedExtraCols = setOverviewCols;

  const { fixedCols, availableExtras, tsCols, catCols, imageCol, indexCols, nameCol, attrCols, predComboCols } = useMemo(() => {
    if (!fieldConfig) return { fixedCols: [], availableExtras: [], tsCols: [], catCols: [], imageCol: '', indexCols: [], nameCol: '', attrCols: [], predComboCols: [] as string[] };
    const indexCols = fieldConfig.columns.index;
    const nameCol = fieldConfig.columns.name;
    const imageCol = fieldConfig.columns.image;
    const attrCols = fieldConfig.columns.attributes;
    const tsCols = fieldConfig.columns.timeseries;
    const catCols = fieldConfig.columns.categoricalTimeseries ?? [];
    const fixedCols = ['__identity', '__attributes'];
    // Build prediction combo column ids
    const predComboCols = (fieldConfig.prediction?.predictions ?? []).map(
      m => `__pred_combo:${m.actualCol}`
    );
    const availableExtras = [...attrCols, ...tsCols, ...catCols, ...predComboCols];
    return { fixedCols, availableExtras, tsCols, catCols, imageCol, indexCols, nameCol, attrCols, predComboCols };
  }, [fieldConfig]);

  const globalCatColorMap = useMemo(() => {
    if (!parsedData || catCols.length === 0) return {};
    return buildGlobalCategoryColorMap(parsedData.rows, catCols);
  }, [parsedData, catCols]);

  // Filter persisted selected columns against what actually exists in the current data
  const selectedExtraCols = useMemo(() => {
    const validSet = new Set(availableExtras);
    return rawSelectedExtraCols.filter(c => validSet.has(c));
  }, [rawSelectedExtraCols, availableExtras]);

  const visibleAttrCols = useMemo(() => {
    const selectedAttrs = selectedExtraCols.filter(c => attrCols.includes(c));
    return selectedAttrs.length > 0 ? selectedAttrs : attrCols;
  }, [selectedExtraCols, attrCols]);

  useEffect(() => {
    if (tsCols.length > 0 && selectedExtraCols.length === 0) {
      setSelectedExtraCols([tsCols[0]]);
    }
  }, [tsCols]);

  const toggleExtraCol = (col: string) => {
    setSelectedExtraCols(
      selectedExtraCols.includes(col) ? selectedExtraCols.filter(c => c !== col) : [...selectedExtraCols, col]
    );
  };

  const displayColumns = useMemo(() => {
    const cols: string[] = [];
    if (imageCol) cols.push('__image');
    cols.push('__identity', '__attributes');
    cols.push(...selectedExtraCols.filter(c => !attrCols.includes(c)));
    return cols;
  }, [imageCol, selectedExtraCols, attrCols]);

  // Precompute attribute metadata
  const attrMeta = useMemo(() => {
    if (!parsedData) return {};
    const meta: Record<string, { isNumeric: boolean; uniqueValues: string[]; range: { min: number; max: number } }> = {};
    for (const ac of attrCols) {
      const isNum = isNumericAttribute(parsedData.rows, ac);
      meta[ac] = {
        isNumeric: isNum,
        uniqueValues: isNum ? [] : getUniqueValues(parsedData.rows, ac),
        range: isNum ? getNumericRange(parsedData.rows, ac) : { min: 0, max: 0 },
      };
    }
    return meta;
  }, [parsedData, attrCols]);

  // Precompute categorical list unique values
  const catListValues = useMemo(() => {
    if (!parsedData) return {};
    const vals: Record<string, string[]> = {};
    for (const col of catCols) {
      vals[col] = getUniqueCatListValues(parsedData.rows, col);
    }
    return vals;
  }, [parsedData, catCols]);

  // Filtering
  const filteredRows = useMemo(() => {
    if (!parsedData) return [];
    let rows = parsedData.rows;

    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter(row =>
        Object.values(row).some(v => String(v ?? '').toLowerCase().includes(q))
      );
    }

    for (const f of columnFilters) {
      if (f.type === 'text') {
        const q = f.value.toLowerCase();
        rows = rows.filter(row => {
          if (f.col === '__identity') {
            const combined = [...indexCols, nameCol].map(c => String(row[c] ?? '')).join(' ');
            return combined.toLowerCase().includes(q);
          }
          if (f.col.startsWith('__attr:')) {
            const attrCol = f.col.slice(7);
            return String(row[attrCol] ?? '').toLowerCase().includes(q);
          }
          if (f.col === '__attributes') {
            const combined = attrCols.map(c => String(row[c] ?? '')).join(' ');
            return combined.toLowerCase().includes(q);
          }
          return String(row[f.col] ?? '').toLowerCase().includes(q);
        });
      } else if (f.type === 'multiselect') {
        rows = rows.filter(row => {
          if (f.col.startsWith('__attr:')) {
            const attrCol = f.col.slice(7);
            return f.values.includes(String(row[attrCol] ?? '').trim());
          }
          if (f.col.startsWith('__catlist:')) {
            const catCol = f.col.slice(10);
            const parsed = parseListValue(row[catCol]);
            if (!parsed) return false;
            const vals = parsed.map(v => String(v).trim());
            return f.values.some(fv => vals.includes(fv));
          }
          return true;
        });
      } else if (f.type === 'range') {
        rows = rows.filter(row => {
          // Attribute range
          if (f.col.startsWith('__attr:')) {
            const attrCol = f.col.slice(7);
            const n = Number(row[attrCol]);
            if (isNaN(n)) return false;
            if (f.min != null && n < f.min) return false;
            if (f.max != null && n > f.max) return false;
            return true;
          }
          // Timeseries stat range: __ts_stat:col (e.g. __ts_max:loss)
          const tsMatch = f.col.match(/^__ts_(min|max|avg|std):(.+)$/);
          if (tsMatch) {
            const stat = tsMatch[1] as 'min' | 'max' | 'avg' | 'std';
            const tsCol = tsMatch[2];
            const parsed = parseListValue(row[tsCol]);
            if (!parsed) return false;
            const nums = parsed.map(Number).filter(n => !isNaN(n));
            const s = computeListStats(nums);
            if (!s) return false;
            const v = s[stat];
            if (f.min != null && v < f.min) return false;
            if (f.max != null && v > f.max) return false;
            return true;
          }
          return true;
        });
      }
    }

    if (sortCol) {
      const resolveSort = (row: Record<string, unknown>) => {
        if (sortCol === '__identity') return [...indexCols, nameCol].map(c => String(row[c] ?? '')).join(' ');
        if (sortCol === '__attributes') return attrCols.map(c => String(row[c] ?? '')).join(' ');
        return String(row[sortCol] ?? '');
      };
      rows = [...rows].sort((a, b) => {
        const va = resolveSort(a);
        const vb = resolveSort(b);
        const na = Number(va), nb = Number(vb);
        const cmp = !isNaN(na) && !isNaN(nb) ? na - nb : va.localeCompare(vb);
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }

    return rows;
  }, [parsedData, search, sortCol, sortDir, columnFilters, indexCols, nameCol, attrCols]);

  const paginatedRows = useMemo(() => filteredRows.slice(page * pageSize, (page + 1) * pageSize), [filteredRows, page]);
  const totalPages = Math.ceil(filteredRows.length / pageSize);

  const handleSort = (col: string) => {
    if (sortCol === col) setOverviewSort(col, sortDir === 'asc' ? 'desc' : 'asc');
    else setOverviewSort(col, 'asc');
  };

  const handleRowClick = (rowIndex: number) => {
    const globalIndex = page * pageSize + rowIndex;
    const actualIndex = parsedData ? parsedData.rows.indexOf(filteredRows[globalIndex]) : globalIndex;
    setSelectedProduct(actualIndex);
    navigate(`/detail/${actualIndex}`);
  };

  const addFilter = (filter: ColumnFilter) => {
    const existing = columnFilters.findIndex(f => f.col === filter.col);
    let updated: ColumnFilter[];
    if (existing >= 0) {
      updated = [...columnFilters];
      updated[existing] = filter;
    } else {
      updated = [...columnFilters, filter];
    }
    setOverviewFilters(updated);
    setPage(0);
  };

  const removeFilter = (col: string) => {
    setOverviewFilters(columnFilters.filter(f => f.col !== col));
    setPage(0);
  };

  const getColLabel = (col: string) => {
    if (col === '__image') return '📷';
    if (col === '__identity') return 'Product';
    if (col === '__attributes') return 'Tags';
    if (col.startsWith('__attr:')) return col.slice(7);
    if (col.startsWith('__catlist:')) return col.slice(10);
    if (col.startsWith('__ts_')) {
      const m = col.match(/^__ts_(min|max|avg|std):(.+)$/);
      if (m) return `${m[2]} (${m[1]})`;
    }
    if (col.startsWith('__pred_combo:')) {
      const actualCol = col.slice('__pred_combo:'.length);
      const predMapping = fieldConfig?.prediction?.predictions.find(m => m.actualCol === actualCol);
      return predMapping ? `${actualCol}+${predMapping.predictionCol}` : actualCol;
    }
    return col;
  };

  if (!parsedData || !fieldConfig) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        No data loaded. Please upload a CSV first.
      </div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }} className="h-[calc(100vh-3rem)] flex flex-col">
      {/* Liquid Glass toolbar */}
      <div className="flex items-center gap-3 px-5 py-3"
        style={{
          background: 'hsl(var(--glass-bg))',
          backdropFilter: 'blur(var(--glass-blur)) saturate(var(--glass-saturate))',
          borderBottom: '0.5px solid hsl(var(--glass-border-subtle))',
        }}
      >
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" />
          <Input
            placeholder="Search all columns..."
            value={search}
            onChange={e => { setOverviewSearch(e.target.value); setPage(0); }}
            className="h-9 pl-10 text-sm"
          />
        </div>

        {/* Column selector */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-9 gap-2 rounded-lg border-border/50 bg-background/60">
              <Columns3 className="h-3.5 w-3.5" />
              <span className="text-xs">Columns</span>
              {selectedExtraCols.length > 0 && (
                <Badge variant="secondary" className="h-5 px-1.5 text-[10px] rounded-full">{selectedExtraCols.length}</Badge>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[600px] p-3" align="end">
            <div className="grid grid-cols-4 gap-x-4 gap-y-0">
              {/* Attributes */}
              <div>
                <div className="text-xs font-medium text-muted-foreground px-1 py-1.5">Attributes</div>
                {attrCols.map(col => (
                  <label key={col} className="flex items-center gap-1.5 px-1 py-1 rounded-md hover:bg-secondary/50 cursor-pointer text-xs">
                    <Checkbox checked={selectedExtraCols.includes(col)} onCheckedChange={() => toggleExtraCol(col)} className="h-3.5 w-3.5" />
                    <span className="truncate">{col}</span>
                  </label>
                ))}
              </div>
              {/* Time Series */}
              {tsCols.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-muted-foreground px-1 py-1.5">Time Series</div>
                  {tsCols.map(col => (
                    <label key={col} className="flex items-center gap-1.5 px-1 py-1 rounded-md hover:bg-secondary/50 cursor-pointer text-xs">
                      <Checkbox checked={selectedExtraCols.includes(col)} onCheckedChange={() => toggleExtraCol(col)} className="h-3.5 w-3.5" />
                      <span className="truncate">{col}</span>
                    </label>
                  ))}
                </div>
              )}
              {/* Categorical */}
              {catCols.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-muted-foreground px-1 py-1.5">Categorical</div>
                  {catCols.map(col => (
                    <label key={col} className="flex items-center gap-1.5 px-1 py-1 rounded-md hover:bg-secondary/50 cursor-pointer text-xs">
                      <Checkbox checked={selectedExtraCols.includes(col)} onCheckedChange={() => toggleExtraCol(col)} className="h-3.5 w-3.5" />
                      <span className="truncate">{col}</span>
                    </label>
                  ))}
                </div>
              )}
              {/* Prediction combos */}
              {predComboCols.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-muted-foreground px-1 py-1.5">Actual + Pred</div>
                  {predComboCols.map(col => (
                    <label key={col} className="flex items-center gap-1.5 px-1 py-1 rounded-md hover:bg-secondary/50 cursor-pointer text-xs">
                      <Checkbox checked={selectedExtraCols.includes(col)} onCheckedChange={() => toggleExtraCol(col)} className="h-3.5 w-3.5" />
                      <span className="truncate">{getColLabel(col)}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </PopoverContent>
        </Popover>

        <div className="flex items-center gap-1.5 ml-auto">
          <Sparkles className="h-3.5 w-3.5 text-primary/60" />
          <span className="text-xs font-medium tabular-nums text-muted-foreground">
            {filteredRows.length.toLocaleString()} <span className="text-muted-foreground/60">records</span>
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 ml-3 text-xs rounded-lg border-border/50 bg-background/60"
            onClick={() => {
              const config = exportConfig();
              const blob = new Blob([config], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `datascope-config-${new Date().toISOString().slice(0, 10)}.json`;
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            <Download className="h-3 w-3" />
            Export Config
          </Button>
        </div>
      </div>

      {/* Active filters bar */}
      <AnimatePresence>
        {columnFilters.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-b bg-secondary/20"
          >
            <div className="flex items-center gap-2 px-5 py-2 flex-wrap">
              <Filter className="h-3 w-3 text-muted-foreground" />
              {columnFilters.map(f => (
                <Badge key={f.col} variant="secondary" className="gap-1 pr-1 rounded-lg text-xs font-normal bg-primary/10 text-primary border-primary/20">
                  <span className="font-medium">{getFilterLabel(f, getColLabel)}</span>
                  <button onClick={() => removeFilter(f.col)} className="ml-0.5 p-0.5 rounded-full hover:bg-primary/20">
                    <X className="h-2.5 w-2.5" />
                  </button>
                </Badge>
              ))}
              <button onClick={() => { setOverviewFilters([]); setPage(0); }} className="text-xs text-muted-foreground hover:text-foreground ml-1">
                Clear all
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 z-10">
            <tr style={{
              background: 'hsl(var(--glass-bg-active))',
              backdropFilter: 'blur(var(--glass-blur)) saturate(var(--glass-saturate))',
              borderBottom: '0.5px solid hsl(var(--glass-border-subtle))',
            }}>
              {displayColumns.map(col => {
                const isTs = tsCols.includes(col);
                const isCat = catCols.includes(col);
                const isImg = col === '__image';
                const isPredCombo = col.startsWith('__pred_combo:');
                const label = getColLabel(col);
                const sortable = !isTs && !isCat && !isImg && !isPredCombo;

                return (
                  <th
                    key={col}
                    className={cn(
                      'px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap select-none',
                      isImg && 'w-[68px]',
                      (isTs || isCat || isPredCombo) && 'w-[160px]',
                      col === '__attributes' && 'min-w-[200px]'
                    )}
                  >
                    <div className="flex items-center gap-1.5">
                      {sortable ? (
                        <button onClick={() => handleSort(col)} className="flex items-center gap-1 hover:text-foreground transition-colors">
                          {label}
                          {sortCol === col ? (
                            sortDir === 'asc' ? <ChevronUp className="h-3 w-3 text-primary" /> : <ChevronDown className="h-3 w-3 text-primary" />
                          ) : (
                            <ArrowUpDown className="h-3 w-3 opacity-30" />
                          )}
                        </button>
                      ) : (
                        <span>{label}</span>
                      )}

                      {/* === FILTER BUTTONS === */}

                      {/* Tags: per-attribute filters matching visible attrs */}
                      {col === '__attributes' && (
                        <TagsFilterPopover
                          attrCols={visibleAttrCols}
                          allAttrCols={attrCols}
                          attrMeta={attrMeta}
                          columnFilters={columnFilters}
                          addFilter={addFilter}
                          removeFilter={removeFilter}
                        />
                      )}

                      {/* Timeseries: stat-based range filters */}
                      {isTs && (
                        <TsFilterPopover
                          col={col}
                          rows={parsedData.rows}
                          columnFilters={columnFilters}
                          addFilter={addFilter}
                          removeFilter={removeFilter}
                        />
                      )}

                      {/* Categorical list: multiselect */}
                      {isCat && (
                        <CatListFilterPopover
                          col={col}
                          uniqueValues={catListValues[col] || []}
                          columnFilters={columnFilters}
                          addFilter={addFilter}
                          removeFilter={removeFilter}
                        />
                      )}

                      {/* Identity / other scalar: text filter */}
                      {col === '__identity' && (
                        <TextFilterPopover
                          col={col}
                          label={label}
                          columnFilters={columnFilters}
                          addFilter={addFilter}
                          removeFilter={removeFilter}
                        />
                      )}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {paginatedRows.map((row, i) => (
              <tr
                key={i}
                className="group glass-row cursor-pointer"
                style={{ borderBottom: '0.5px solid hsl(var(--glass-border-subtle))' }}
                onClick={() => handleRowClick(i)}
              >
                {displayColumns.map(col => {
                  if (col === '__image') {
                    const url = String(row[imageCol] ?? '');
                    return (
                      <td key={col} className="px-4 py-2.5">
                        {url && url.startsWith('http') ? (
                          <div className="h-14 w-14 rounded-lg overflow-hidden bg-muted ring-1 ring-border/30 group-hover:ring-primary/30 transition-all">
                            <img src={url} alt="" className="h-full w-full object-cover" loading="lazy" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                          </div>
                        ) : (
                          <div className="h-14 w-14 rounded-lg bg-muted/50 flex items-center justify-center text-muted-foreground/40 text-xs ring-1 ring-border/20">—</div>
                        )}
                      </td>
                    );
                  }
                  if (col === '__identity') {
                    const name = String(row[nameCol] ?? '');
                    const ids = indexCols.filter(c => c !== nameCol).map(c => String(row[c] ?? '')).filter(Boolean);
                    return (
                      <td key={col} className="px-4 py-2.5">
                        <div className="flex flex-col">
                          <span className="text-sm font-medium text-foreground group-hover:text-primary transition-colors truncate max-w-[220px]">{name}</span>
                          {ids.length > 0 && (
                            <span className="text-[11px] text-muted-foreground font-mono">{ids.join(' · ')}</span>
                          )}
                        </div>
                      </td>
                    );
                  }
                  if (col === '__attributes') {
                    return (
                      <td key={col} className="px-4 py-2.5">
                        <div className="flex flex-wrap gap-1">
                          {visibleAttrCols.map((ac) => {
                            const ai = attrCols.indexOf(ac);
                            const val = String(row[ac] ?? '').trim();
                            if (!val) return null;
                            const short = val.length > 16 ? val.slice(0, 16) + '…' : val;
                            const colorClass = ATTR_COLORS[ai % ATTR_COLORS.length];
                            return (
                              <span key={ac} className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium border whitespace-nowrap', colorClass)} title={`${ac}: ${val}`}>
                                <span className="text-[9px] opacity-60 uppercase">{ac.slice(0, 3)}</span>
                                {short}
                              </span>
                            );
                          })}
                        </div>
                      </td>
                    );
                  }
                  if (tsCols.includes(col)) {
                    const values = parseListValue(row[col]);
                    if (values && values.length > 0) {
                      return (
                        <td key={col} className="px-4 py-2.5">
                          <MiniSparkline data={values.map(Number)} width={120} height={30} color={CURVE_COLORS[tsCols.indexOf(col) % CURVE_COLORS.length]} />
                        </td>
                      );
                    }
                  }
                  if (col.startsWith('__pred_combo:')) {
                    const actualCol = col.slice('__pred_combo:'.length);
                    const predMapping = fieldConfig?.prediction?.predictions.find(m => m.actualCol === actualCol);
                    if (predMapping) {
                      const actualValues = parseListValue(row[actualCol]);
                      const predValues = parseListValue(row[predMapping.predictionCol]);
                      const upperValues = predMapping.upperBoundCol ? parseListValue(row[predMapping.upperBoundCol]) : null;
                      const lowerValues = predMapping.lowerBoundCol ? parseListValue(row[predMapping.lowerBoundCol]) : null;

                      // Build merged timeline from actual timepoints + pred timepoints
                      const timepointCol = fieldConfig?.columns.timepoint ?? '';
                      const predTimepointCol = fieldConfig?.prediction?.timepoint ?? '';
                      const actualXRaw = parseListValue(row[timepointCol]);
                      const predXRaw = parseListValue(row[predTimepointCol]);
                      const actualXStrs = actualXRaw ? actualXRaw.map(String) : [];
                      const predXStrs = predXRaw ? predXRaw.map(String) : [];

                      // Merge, deduplicate, sort
                      const xSet = new Set(actualXStrs);
                      const predOnlyX = predXStrs.filter(x => !xSet.has(x));
                      const mergedX = [...actualXStrs, ...predOnlyX].sort((a, b) => {
                        const na = Number(a), nb = Number(b);
                        return (!isNaN(na) && !isNaN(nb)) ? na - nb : a.localeCompare(b);
                      });

                      const actualData = actualValues ? actualValues.map(Number) : [];
                      const predData = predValues ? predValues.map(Number) : [];
                      const upperData = upperValues ? upperValues.map(Number) : [];
                      const lowerData = lowerValues ? lowerValues.map(Number) : [];

                      // Build aligned arrays (same length as mergedX)
                      const alignedActual = mergedX.map(x => {
                        const idx = actualXStrs.indexOf(x);
                        return idx >= 0 && idx < actualData.length ? actualData[idx] : NaN;
                      });
                      const alignedPred = mergedX.map(x => {
                        const idx = predXStrs.indexOf(x);
                        return idx >= 0 && idx < predData.length ? predData[idx] : NaN;
                      });
                      const alignedUpper = upperData.length > 0 ? mergedX.map(x => {
                        const idx = predXStrs.indexOf(x);
                        return idx >= 0 && idx < upperData.length ? upperData[idx] : NaN;
                      }) : undefined;
                      const alignedLower = lowerData.length > 0 ? mergedX.map(x => {
                        const idx = predXStrs.indexOf(x);
                        return idx >= 0 && idx < lowerData.length ? lowerData[idx] : NaN;
                      }) : undefined;

                      return (
                        <td key={col} className="px-4 py-2.5">
                          <MiniSparkline
                            data={alignedActual}
                            width={140}
                            height={30}
                            color={CURVE_COLORS[tsCols.indexOf(actualCol) % CURVE_COLORS.length]}
                            predictionData={alignedPred}
                            upperBound={alignedUpper}
                            lowerBound={alignedLower}
                            noFill
                            aligned
                          />
                        </td>
                      );
                    }
                  }
                  if (catCols.includes(col)) {
                    const values = parseListValue(row[col]);
                    if (values && values.length > 0) {
                      return (
                        <td key={col} className="px-4 py-2.5">
                          <MiniCategoricalChart data={values.map(String)} width={120} height={28} colorMap={globalCatColorMap} />
                        </td>
                      );
                    }
                  }
                  const display = String(row[col] ?? '');
                  const truncated = display.length > 28 ? display.slice(0, 28) + '…' : display;
                  return (
                    <td key={col} className="px-4 py-2.5 text-sm font-mono tabular-nums text-foreground/80 whitespace-nowrap">
                      {truncated}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modern pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-5 py-2.5" style={{
          background: 'hsl(var(--glass-bg))',
          backdropFilter: 'blur(var(--glass-blur))',
          borderTop: '0.5px solid hsl(var(--glass-border-subtle))',
        }}>
          <span className="text-xs text-muted-foreground">
            Showing <span className="font-medium text-foreground">{page * pageSize + 1}–{Math.min((page + 1) * pageSize, filteredRows.length)}</span> of {filteredRows.length.toLocaleString()}
          </span>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-7 w-7" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
              let p: number;
              if (totalPages <= 5) p = i;
              else if (page < 3) p = i;
              else if (page > totalPages - 4) p = totalPages - 5 + i;
              else p = page - 2 + i;
              return (
                <Button key={p} variant={p === page ? 'default' : 'ghost'} size="icon" className={cn('h-7 w-7 text-xs', p === page && 'pointer-events-none')} onClick={() => setPage(p)}>
                  {p + 1}
                </Button>
              );
            })}
            <Button variant="ghost" size="icon" className="h-7 w-7" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </motion.div>
  );
}

/* ─── Sub-components for filter popovers ─── */

/** Tags filter: per-attribute with categorical multiselect or numeric range */
function TagsFilterPopover({ attrCols, allAttrCols, attrMeta, columnFilters, addFilter, removeFilter }: {
  attrCols: string[];
  allAttrCols: string[];
  attrMeta: Record<string, { isNumeric: boolean; uniqueValues: string[]; range: { min: number; max: number } }>;
  columnFilters: ColumnFilter[];
  addFilter: (f: ColumnFilter) => void;
  removeFilter: (col: string) => void;
}) {
  const hasAnyFilter = columnFilters.some(f => f.col.startsWith('__attr:'));

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className={cn('p-0.5 rounded transition-colors', hasAnyFilter ? 'text-primary' : 'text-muted-foreground/40 hover:text-muted-foreground')}>
          <Filter className="h-3 w-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3 max-h-80 overflow-auto" align="start">
        <div className="text-xs font-medium mb-2">Filter by Attribute</div>
        <div className="space-y-3">
          {attrCols.map((ac, ai) => {
            const filterKey = `__attr:${ac}`;
            const meta = attrMeta[ac];
            if (!meta) return null;

            if (meta.isNumeric) {
              return <RangeFilterSection key={ac} label={ac} filterKey={filterKey} range={meta.range} columnFilters={columnFilters} addFilter={addFilter} removeFilter={removeFilter} colorIdx={ai} />;
            } else {
              return <MultiselectFilterSection key={ac} label={ac} filterKey={filterKey} uniqueValues={meta.uniqueValues} columnFilters={columnFilters} addFilter={addFilter} removeFilter={removeFilter} colorIdx={ai} />;
            }
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Timeseries stat filter: 4 range filters for max/min/avg/std */
function TsFilterPopover({ col, rows, columnFilters, addFilter, removeFilter }: {
  col: string;
  rows: Record<string, unknown>[];
  columnFilters: ColumnFilter[];
  addFilter: (f: ColumnFilter) => void;
  removeFilter: (col: string) => void;
}) {
  const stats = ['max', 'min', 'avg', 'std'] as const;
  const hasAnyFilter = stats.some(s => columnFilters.some(f => f.col === `__ts_${s}:${col}`));

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className={cn('p-0.5 rounded transition-colors', hasAnyFilter ? 'text-primary' : 'text-muted-foreground/40 hover:text-muted-foreground')}>
          <Filter className="h-3 w-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3" align="start">
        <div className="text-xs font-medium mb-2">Filter: {col}</div>
        <div className="space-y-3">
          {stats.map(stat => {
            const fKey = `__ts_${stat}:${col}`;
            const range = getTsStatRange(rows, col, stat);
            return <RangeFilterSection key={stat} label={stat.toUpperCase()} filterKey={fKey} range={range} columnFilters={columnFilters} addFilter={addFilter} removeFilter={removeFilter} />;
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Categorical list filter: multiselect */
function CatListFilterPopover({ col, uniqueValues, columnFilters, addFilter, removeFilter }: {
  col: string;
  uniqueValues: string[];
  columnFilters: ColumnFilter[];
  addFilter: (f: ColumnFilter) => void;
  removeFilter: (col: string) => void;
}) {
  const filterKey = `__catlist:${col}`;
  const existing = columnFilters.find(f => f.col === filterKey);
  const selectedValues = existing?.type === 'multiselect' ? existing.values : [];
  const hasFilter = selectedValues.length > 0;
  const [searchTerm, setSearchTerm] = useState('');

  const filtered = searchTerm
    ? uniqueValues.filter(v => v.toLowerCase().includes(searchTerm.toLowerCase()))
    : uniqueValues;

  const toggle = (val: string) => {
    const next = selectedValues.includes(val)
      ? selectedValues.filter(v => v !== val)
      : [...selectedValues, val];
    if (next.length === 0) removeFilter(filterKey);
    else addFilter({ col: filterKey, type: 'multiselect', values: next });
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className={cn('p-0.5 rounded transition-colors', hasFilter ? 'text-primary' : 'text-muted-foreground/40 hover:text-muted-foreground')}>
          <Filter className="h-3 w-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-3 max-h-72 overflow-auto" align="start">
        <div className="text-xs font-medium mb-2">Filter: {col}</div>
        {uniqueValues.length > 8 && (
          <Input value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="Search..." className="h-6 text-xs mb-2" />
        )}
        <div className="space-y-1 max-h-48 overflow-auto">
          {filtered.map(val => (
            <label key={val} className="flex items-center gap-2 px-1 py-1 rounded hover:bg-secondary/50 cursor-pointer text-xs">
              <Checkbox checked={selectedValues.includes(val)} onCheckedChange={() => toggle(val)} className="h-3.5 w-3.5" />
              <span className="truncate">{val}</span>
            </label>
          ))}
        </div>
        {hasFilter && (
          <button onClick={() => removeFilter(filterKey)} className="text-[10px] text-destructive mt-2 hover:underline">Clear</button>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** Simple text filter */
function TextFilterPopover({ col, label, columnFilters, addFilter, removeFilter }: {
  col: string;
  label: string;
  columnFilters: ColumnFilter[];
  addFilter: (f: ColumnFilter) => void;
  removeFilter: (col: string) => void;
}) {
  const existing = columnFilters.find(f => f.col === col);
  const hasFilter = !!existing;
  const [input, setInput] = useState(existing?.type === 'text' ? existing.value : '');

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className={cn('p-0.5 rounded transition-colors', hasFilter ? 'text-primary' : 'text-muted-foreground/40 hover:text-muted-foreground')}>
          <Filter className="h-3 w-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-52 p-3" align="start">
        <div className="text-xs font-medium mb-2">Filter: {label}</div>
        <div className="flex gap-1.5">
          <Input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && input.trim()) addFilter({ col, type: 'text', value: input }); }}
            placeholder="Contains..."
            className="h-7 text-xs"
            autoFocus
          />
          <Button size="sm" className="h-7 px-2 text-xs" onClick={() => { if (input.trim()) addFilter({ col, type: 'text', value: input }); }}>OK</Button>
        </div>
        {hasFilter && (
          <button onClick={() => { removeFilter(col); setInput(''); }} className="text-xs text-destructive mt-2 hover:underline">Remove</button>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** Reusable range filter (min/max inputs) */
function RangeFilterSection({ label, filterKey, range, columnFilters, addFilter, removeFilter, colorIdx }: {
  label: string;
  filterKey: string;
  range: { min: number; max: number };
  columnFilters: ColumnFilter[];
  addFilter: (f: ColumnFilter) => void;
  removeFilter: (col: string) => void;
  colorIdx?: number;
}) {
  const existing = columnFilters.find(f => f.col === filterKey);
  const curMin = existing?.type === 'range' ? existing.min : undefined;
  const curMax = existing?.type === 'range' ? existing.max : undefined;
  const [minVal, setMinVal] = useState(curMin != null ? String(curMin) : '');
  const [maxVal, setMaxVal] = useState(curMax != null ? String(curMax) : '');

  const apply = () => {
    const mn = minVal ? Number(minVal) : undefined;
    const mx = maxVal ? Number(maxVal) : undefined;
    if (mn == null && mx == null) { removeFilter(filterKey); return; }
    addFilter({ col: filterKey, type: 'range', min: mn, max: mx });
  };

  return (
    <div>
      <div className="text-[10px] text-muted-foreground font-medium mb-1 flex items-center gap-1">
        {colorIdx != null && <div className={cn('w-2 h-2 rounded-sm', ATTR_COLORS[colorIdx % ATTR_COLORS.length].split(' ')[0])} />}
        {label}
        <span className="text-muted-foreground/40 ml-auto">{range.min.toFixed(2)} – {range.max.toFixed(2)}</span>
      </div>
      <div className="flex gap-1">
        <Input
          type="number"
          value={minVal}
          onChange={e => setMinVal(e.target.value)}
          placeholder="Min"
          className="h-6 text-xs flex-1"
          onKeyDown={e => e.key === 'Enter' && apply()}
        />
        <Input
          type="number"
          value={maxVal}
          onChange={e => setMaxVal(e.target.value)}
          placeholder="Max"
          className="h-6 text-xs flex-1"
          onKeyDown={e => e.key === 'Enter' && apply()}
        />
        <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 text-xs" onClick={apply}>✓</Button>
        {existing && (
          <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => { removeFilter(filterKey); setMinVal(''); setMaxVal(''); }}>
            <X className="h-2.5 w-2.5" />
          </Button>
        )}
      </div>
    </div>
  );
}

/** Reusable multiselect filter */
function MultiselectFilterSection({ label, filterKey, uniqueValues, columnFilters, addFilter, removeFilter, colorIdx }: {
  label: string;
  filterKey: string;
  uniqueValues: string[];
  columnFilters: ColumnFilter[];
  addFilter: (f: ColumnFilter) => void;
  removeFilter: (col: string) => void;
  colorIdx?: number;
}) {
  const existing = columnFilters.find(f => f.col === filterKey);
  const selectedValues = existing?.type === 'multiselect' ? existing.values : [];
  const [searchTerm, setSearchTerm] = useState('');

  const filtered = searchTerm
    ? uniqueValues.filter(v => v.toLowerCase().includes(searchTerm.toLowerCase()))
    : uniqueValues;

  const toggle = (val: string) => {
    const next = selectedValues.includes(val)
      ? selectedValues.filter(v => v !== val)
      : [...selectedValues, val];
    if (next.length === 0) removeFilter(filterKey);
    else addFilter({ col: filterKey, type: 'multiselect', values: next });
  };

  return (
    <div>
      <div className="text-[10px] text-muted-foreground font-medium mb-1 flex items-center gap-1">
        {colorIdx != null && <div className={cn('w-2 h-2 rounded-sm', ATTR_COLORS[colorIdx % ATTR_COLORS.length].split(' ')[0])} />}
        {label}
        {selectedValues.length > 0 && <span className="text-primary ml-auto">({selectedValues.length})</span>}
      </div>
      {uniqueValues.length > 6 && (
        <Input value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="Search..." className="h-5 text-[10px] mb-1" />
      )}
      <div className="space-y-0.5 max-h-32 overflow-auto">
        {filtered.slice(0, 30).map(val => (
          <label key={val} className="flex items-center gap-1.5 px-1 py-0.5 rounded hover:bg-secondary/50 cursor-pointer text-[11px]">
            <Checkbox checked={selectedValues.includes(val)} onCheckedChange={() => toggle(val)} className="h-3 w-3" />
            <span className="truncate">{val}</span>
          </label>
        ))}
        {filtered.length > 30 && <div className="text-[10px] text-muted-foreground px-1">+{filtered.length - 30} more</div>}
      </div>
      {selectedValues.length > 0 && (
        <button onClick={() => removeFilter(filterKey)} className="text-[10px] text-destructive mt-1 hover:underline">Clear</button>
      )}
    </div>
  );
}
