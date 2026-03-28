import { useMemo, useState, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useDataStore } from '@/lib/data-store';
import { parseListValue } from '@/lib/csv-parser';
import type { ChartTemplate } from '@/lib/csv-parser';
import { CURVE_COLORS as CHART_COLORS, formatYValue, buildGlobalCategoryColorMap } from '@/lib/curve-utils';
import {
  buildChartData, buildChartLines, buildReferenceElements,
  buildCategoricalOverlays, buildCategoryLegendItems, getPredColSet,
  buildShapAreas, mergeShapIntoChartData, buildShapAreaElements,
  type ShapAreasResult,
} from '@/lib/chart-builder';
import { ArrowLeft, Filter, ChevronLeft, ChevronRight, ChevronDown, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import {
  ComposedChart, AreaChart, Area, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid,
} from 'recharts';

const SIDEBAR_PAGE_SIZE = 50;

function ChartMultiSelect({ tsCols, catCols, predCombos, templates, selectedItems, toggleItem, clearAll }: {
  tsCols: string[];
  catCols: string[];
  predCombos: { id: string; label: string }[];
  templates: { id: string; name: string }[];
  selectedItems: string[];
  toggleItem: (item: string) => void;
  clearAll: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const label = selectedItems.length === 0
    ? 'All (default)'
    : `${selectedItems.length} selected`;

  return (
    <div className="ml-auto flex items-center gap-2 relative" ref={ref}>
      <span className="text-xs text-muted-foreground/70 font-medium">Charts:</span>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1 h-7 px-2.5 rounded-lg border border-input bg-background/60 text-xs min-w-[160px] justify-between hover:border-primary/30 transition-colors"
      >
        <span className="truncate text-foreground/80">{label}</span>
        <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground/50" />
      </button>
      {selectedItems.length > 0 && (
        <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive" onClick={clearAll}>
          <X className="h-3 w-3" />
        </Button>
      )}
      {open && (
        <div className="absolute right-0 top-9 z-50 w-[230px] rounded-xl border bg-popover p-1.5 shadow-lg max-h-[300px] overflow-auto">
          {tsCols.length > 0 && (
            <>
              <div className="px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-0.5">Time Series</div>
              {tsCols.map(col => (
                <label key={col} className="flex items-center gap-2.5 px-2.5 py-2 text-xs rounded-lg hover:bg-secondary/60 cursor-pointer transition-colors">
                  <Checkbox checked={selectedItems.includes(col)} onCheckedChange={() => toggleItem(col)} className="h-3.5 w-3.5" />
                  <span className="font-mono text-foreground truncate">{col}</span>
                </label>
              ))}
            </>
          )}
          {catCols && catCols.length > 0 && (
            <>
              <div className="px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground mt-1 border-t pt-2">Categorical</div>
              {catCols.map(col => (
                <label key={col} className="flex items-center gap-2.5 px-2.5 py-2 text-xs rounded-lg hover:bg-secondary/60 cursor-pointer transition-colors">
                  <Checkbox checked={selectedItems.includes(col)} onCheckedChange={() => toggleItem(col)} className="h-3.5 w-3.5" />
                  <span className="font-mono text-foreground truncate">{col}</span>
                </label>
              ))}
            </>
          )}
          {predCombos.length > 0 && (
            <>
              <div className="px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground mt-1 border-t pt-2">Actual + Pred</div>
              {predCombos.map(pc => (
                <label key={pc.id} className="flex items-center gap-2.5 px-2.5 py-2 text-xs rounded-lg hover:bg-secondary/60 cursor-pointer transition-colors">
                  <Checkbox checked={selectedItems.includes(pc.id)} onCheckedChange={() => toggleItem(pc.id)} className="h-3.5 w-3.5" />
                  <span className="font-mono text-foreground truncate">{pc.label}</span>
                </label>
              ))}
            </>
          )}
          {templates.length > 0 && (
            <>
              <div className="px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground mt-1 border-t pt-2">Templates</div>
              {templates.map(t => (
                <label key={t.id} className="flex items-center gap-2.5 px-2.5 py-2 text-xs rounded-lg hover:bg-secondary/60 cursor-pointer transition-colors">
                  <Checkbox checked={selectedItems.includes(t.id)} onCheckedChange={() => toggleItem(t.id)} className="h-3.5 w-3.5" />
                  <span className="truncate text-foreground">{t.name}</span>
                </label>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function DetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { parsedData, fieldConfig, templates, selectedProductIndex, setSelectedProduct, viewState, setDetailItems } = useDataStore();
  const [sidebarPage, setSidebarPage] = useState(0);

  const selectedItems = viewState.detailSelectedItems;
  const setSelectedItems = (items: string[] | ((prev: string[]) => string[])) => {
    if (typeof items === 'function') {
      setDetailItems(items(viewState.detailSelectedItems));
    } else {
      setDetailItems(items);
    }
  };

  const productIndex = id !== undefined ? Number(id) : selectedProductIndex;
  const currentRow = parsedData?.rows[productIndex];
  const tsCols = fieldConfig?.columns.timeseries ?? [];
  const catCols = fieldConfig?.columns.categoricalTimeseries ?? [];
  const globalCatColorMap = useMemo(() => {
    if (!parsedData || catCols.length === 0) return {};
    return buildGlobalCategoryColorMap(parsedData.rows, catCols);
  }, [parsedData, catCols]);
  const predCombos = useMemo(() => {
    return (fieldConfig?.prediction?.predictions ?? []).map(m => ({
      id: `__pred_combo:${m.actualCol}`,
      label: `${m.actualCol} + ${m.predictionCol}`,
    }));
  }, [fieldConfig]);

  const productName = currentRow && fieldConfig ? String(currentRow[fieldConfig.columns.name] ?? `Product ${productIndex}`) : '';
  const imageUrl = currentRow && fieldConfig?.columns.image ? String(currentRow[fieldConfig.columns.image] ?? '') : '';

  const overviewSearch = viewState.overviewSearch;
  const overviewSortCol = viewState.overviewSortCol;
  const overviewSortDir = viewState.overviewSortDir;
  const overviewFilters = viewState.overviewColumnFilters;

  const indexCols = fieldConfig?.columns.index ?? [];
  const nameCol = fieldConfig?.columns.name ?? '';
  const attrCols = fieldConfig?.columns.attributes ?? [];

  const productList = useMemo(() => {
    if (!parsedData || !fieldConfig) return [];
    return parsedData.rows.map((row, idx) => ({
      idx,
      name: String(row[fieldConfig.columns.name] ?? `#${idx}`),
      indexValues: fieldConfig.columns.index.map(c => String(row[c] ?? '')),
      image: fieldConfig.columns.image ? String(row[fieldConfig.columns.image] ?? '') : '',
    }));
  }, [parsedData, fieldConfig]);

  const filteredProducts = useMemo(() => {
    if (!parsedData) return productList;
    let items = productList;

    if (overviewSearch) {
      const q = overviewSearch.toLowerCase();
      items = items.filter(p => {
        const row = parsedData.rows[p.idx];
        return Object.values(row).some(v => String(v ?? '').toLowerCase().includes(q));
      });
    }

    for (const f of overviewFilters) {
      if (f.type === 'text') {
        const q = f.value.toLowerCase();
        items = items.filter(p => {
          const row = parsedData.rows[p.idx];
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
        items = items.filter(p => {
          const row = parsedData.rows[p.idx];
          if (f.col.startsWith('__attr:')) {
            const attrCol = f.col.slice(7);
            return f.values.includes(String(row[attrCol] ?? ''));
          }
          return true;
        });
      }
    }

    if (overviewSortCol && parsedData) {
      const resolveSort = (p: typeof items[0]) => {
        const row = parsedData.rows[p.idx];
        if (overviewSortCol === '__identity') {
          return [...indexCols, nameCol].map(c => String(row[c] ?? '')).join(' ');
        }
        if (overviewSortCol === '__attributes') {
          return attrCols.map(c => String(row[c] ?? '')).join(' ');
        }
        return String(row[overviewSortCol] ?? '');
      };
      items = [...items].sort((a, b) => {
        const va = resolveSort(a);
        const vb = resolveSort(b);
        const na = Number(va), nb = Number(vb);
        const cmp = !isNaN(na) && !isNaN(nb) ? na - nb : va.localeCompare(vb);
        return overviewSortDir === 'asc' ? cmp : -cmp;
      });
    }

    return items;
  }, [productList, parsedData, overviewSearch, overviewSortCol, overviewSortDir, overviewFilters, indexCols, nameCol, attrCols]);

  const sidebarTotalPages = Math.ceil(filteredProducts.length / SIDEBAR_PAGE_SIZE);
  const paginatedProducts = useMemo(() => {
    return filteredProducts.slice(sidebarPage * SIDEBAR_PAGE_SIZE, (sidebarPage + 1) * SIDEBAR_PAGE_SIZE);
  }, [filteredProducts, sidebarPage]);

  const toggleItem = (item: string) => {
    setSelectedItems(prev => prev.includes(item) ? prev.filter(i => i !== item) : [...prev, item]);
  };

  const predColSet = useMemo(() => getPredColSet(fieldConfig ?? null), [fieldConfig]);

  const chartConfigs = useMemo(() => {
    const items = selectedItems.length > 0 ? selectedItems : tsCols;
    const configs: ChartTemplate[] = [];
    items.forEach(item => {
      const tmpl = templates.find(t => t.id === item);
      if (tmpl) {
        configs.push(tmpl);
      } else if (tsCols.includes(item)) {
        configs.push({
          id: item, name: item,
          xAxis: fieldConfig?.columns.timepoint ?? '',
          yAxisLeft: [item], yAxisRight: [],
        });
      } else if (catCols.includes(item)) {
        configs.push({
          id: `cat__${item}`, name: item,
          xAxis: fieldConfig?.columns.timepoint ?? '',
          yAxisLeft: [], yAxisRight: [],
          categoricalCols: [item],
        });
      } else if (item.startsWith('__pred_combo:')) {
        const actualCol = item.slice('__pred_combo:'.length);
        const mapping = fieldConfig?.prediction?.predictions.find(m => m.actualCol === actualCol);
        if (mapping) {
          configs.push({
            id: item, name: `${actualCol} + ${mapping.predictionCol}`,
            xAxis: fieldConfig?.columns.timepoint ?? '',
            yAxisLeft: [actualCol], yAxisRight: [],
          });
        }
      }
    });
    return configs;
  }, [selectedItems, tsCols, catCols, templates, fieldConfig]);

  if (!parsedData || !fieldConfig) {
    return <div className="flex items-center justify-center h-full text-muted-foreground text-sm">No data loaded.</div>;
  }

  if (!currentRow) {
    return <div className="flex items-center justify-center h-full text-muted-foreground text-sm">Product not found.</div>;
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }} className="h-[calc(100vh-3rem)] flex">
      {/* Left sidebar */}
      <div className="w-[230px] flex flex-col shrink-0"
        style={{
          background: 'hsl(var(--glass-bg))',
          backdropFilter: 'blur(var(--glass-blur)) saturate(var(--glass-saturate))',
          borderRight: '0.5px solid hsl(var(--glass-border-subtle))',
        }}
      >
        {(overviewSearch || overviewFilters.length > 0) && (
          <div className="px-2.5 py-2 border-b text-[10px] text-muted-foreground flex items-center gap-1.5 flex-wrap">
            <Filter className="h-3 w-3 shrink-0" />
            {overviewSearch && <Badge variant="secondary" className="text-[10px] h-4 px-1.5 rounded">"{overviewSearch}"</Badge>}
            {overviewFilters.map(f => (
              <Badge key={f.col} variant="secondary" className="text-[10px] h-4 px-1.5 rounded">
                {f.type === 'text' ? f.value : f.type === 'multiselect' ? f.values.join(', ') : 'range'}
              </Badge>
            ))}
            <span className="text-muted-foreground/50">· {filteredProducts.length}</span>
          </div>
        )}
        <div className="flex-1 overflow-auto">
          {paginatedProducts.map(p => (
            <div
              key={p.idx}
              className={cn(
                'px-3 py-2.5 cursor-pointer flex items-center gap-2.5 text-xs transition-all duration-200',
                p.idx === productIndex
                  ? 'bg-primary/8 border-l-2 border-l-primary'
                  : 'hover:bg-[hsl(var(--glass-bg-hover))] border-l-2 border-l-transparent'
              )}
              onClick={() => { setSelectedProduct(p.idx); navigate(`/detail/${p.idx}`, { replace: true }); }}
            >
              {p.image && p.image.startsWith('http') ? (
                <img src={p.image} alt="" className="h-9 w-9 rounded-lg object-cover bg-muted shrink-0 ring-1 ring-border/20" loading="lazy" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
              ) : (
                <div className="h-9 w-9 rounded-lg bg-muted/40 shrink-0 ring-1 ring-border/10" />
              )}
              <div className="min-w-0">
                <div className={cn(
                  'truncate transition-colors',
                  p.idx === productIndex ? 'font-semibold text-primary' : 'font-medium text-foreground/80'
                )}>{p.name}</div>
                <div className="text-muted-foreground/50 truncate text-[10px]">{p.indexValues.join(' · ')}</div>
              </div>
            </div>
          ))}
        </div>
        {sidebarTotalPages > 1 && (
          <div className="flex items-center justify-between px-2.5 py-2 border-t bg-card/30 text-xs">
            <Button variant="ghost" size="icon" className="h-6 w-6" disabled={sidebarPage === 0} onClick={() => setSidebarPage(p => p - 1)}>
              <ChevronLeft className="h-3 w-3" />
            </Button>
            <span className="text-muted-foreground/60 tabular-nums text-[11px]">{sidebarPage + 1}/{sidebarTotalPages}</span>
            <Button variant="ghost" size="icon" className="h-6 w-6" disabled={sidebarPage >= sidebarTotalPages - 1} onClick={() => setSidebarPage(p => p + 1)}>
              <ChevronRight className="h-3 w-3" />
            </Button>
          </div>
        )}
      </div>

      {/* Right content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-2.5 border-b bg-card/40 backdrop-blur-sm text-xs shrink-0 relative z-20">
          <Button variant="ghost" size="sm" onClick={() => navigate('/overview')} className="h-7 text-xs gap-1.5 px-2.5 text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" /> Overview
          </Button>
          <span className="text-border">›</span>
          <span className="font-semibold text-foreground">{productName}</span>
          <ChartMultiSelect
            tsCols={tsCols}
            catCols={catCols}
            predCombos={predCombos}
            templates={templates}
            selectedItems={selectedItems}
            toggleItem={toggleItem}
            clearAll={() => setSelectedItems([])}
          />
        </div>

        <div className="flex-1 overflow-auto p-5 space-y-5">
          {/* Product info card */}
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className="rounded-xl bg-card/60 backdrop-blur-sm p-5 flex gap-6"
            style={{ boxShadow: 'var(--shadow-soft)', border: '0.5px solid hsl(var(--glass-border-subtle))' }}
          >
            {imageUrl && imageUrl.startsWith('http') && (
              <div className="shrink-0">
                <img
                  src={imageUrl}
                  alt={productName}
                  className="h-36 w-36 rounded-xl object-cover bg-muted ring-1 ring-border/20"
                  loading="lazy"
                />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <h1 className="text-lg font-bold text-foreground tracking-tight mb-3">{productName}</h1>
              <div className="grid grid-cols-3 gap-x-6 gap-y-3">
                {fieldConfig.columns.index.filter(c => c !== fieldConfig.columns.name).map(col => (
                  <div key={col}>
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 mb-0.5">{col}</div>
                    <div className="text-sm font-mono text-foreground/90">{String(currentRow[col] ?? '—')}</div>
                  </div>
                ))}
                {fieldConfig.columns.attributes.map(col => (
                  <div key={col}>
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 mb-0.5">{col}</div>
                    <div className="text-sm font-mono text-foreground/70">{String(currentRow[col] ?? '—')}</div>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>

          {/* Charts */}
          {chartConfigs.length > 0 && (
            <div className="space-y-4">
              {chartConfigs.map((config, ci) => {
                const allY = [...config.yAxisLeft, ...config.yAxisRight];
                const isCatOnly = allY.length === 0 && (config.categoricalCols?.length ?? 0) > 0;
                const isPredCombo = config.id.startsWith('__pred_combo:');
                // Detect if template has prediction columns
                const templateHasPredCols = allY.some(c => predColSet.has(c));

                // Build SHAP areas for templates that have explanationCols
                const tmplExplanationCols = (config as any).explanationCols as string[] | undefined;
                const tmplShapTopK = (config as any).shapTopK as number | null | undefined;
                const shapAreas: ShapAreasResult | null =
                  (tmplExplanationCols && tmplExplanationCols.length > 0)
                    ? buildShapAreas(currentRow, fieldConfig, tmplExplanationCols, tmplShapTopK)
                    : null;

                let data = buildChartData({
                  row: currentRow,
                  template: config,
                  fieldConfig,
                  enablePrediction: isPredCombo || templateHasPredCols,
                });

                // Merge SHAP data
                if (shapAreas && data.length > 0) {
                  data = mergeShapIntoChartData(data, shapAreas);
                }

                // For categorical-only charts, build minimal x-axis data
                if (data.length === 0 && isCatOnly) {
                  const xValues = parseListValue(currentRow[config.xAxis]);
                  if (xValues) {
                    data = xValues.map((x, i) => ({ x: String(x), index: i, __placeholder: 0 }));
                  }
                }
                if (data.length === 0) return null;
                const hasRightAxis = config.yAxisRight.length > 0;

                const lineElements = buildChartLines({
                  template: config,
                  isPredCombo,
                  fieldConfig,
                  row: currentRow,
                });

                const refElements = buildReferenceElements(config, data, currentRow);
                const catOverlays = buildCategoricalOverlays(currentRow, config, globalCatColorMap);
                const catLegend = buildCategoryLegendItems(currentRow, config, globalCatColorMap);

                return (
                  <motion.div
                    key={config.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.25, delay: ci * 0.06 }}
                    className="rounded-xl bg-card/60 backdrop-blur-sm p-5"
                    style={{ boxShadow: 'var(--shadow-soft)', border: '0.5px solid hsl(var(--glass-border-subtle))' }}
                  >
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-sm font-semibold text-foreground tracking-tight">{config.name}</h3>
                      <span className="text-[10px] font-medium text-muted-foreground/50 tabular-nums">{data.length} points</span>
                    </div>
                    <ResponsiveContainer width="100%" height={isCatOnly ? 80 : 240}>
                      {(() => {
                        const ChartComp = config.stacked ? AreaChart : ComposedChart;
                        return (
                        <ChartComp data={data} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.5)" />
                        <XAxis dataKey="x"
                          tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground) / 0.5)' }}
                          axisLine={{ stroke: 'hsl(var(--border) / 0.4)' }}
                          tickLine={false}
                          interval={Math.max(0, Math.floor(data.length / 8))} />
                        <YAxis yAxisId="left"
                          tick={isCatOnly ? false : { fontSize: 10, fill: 'hsl(var(--muted-foreground) / 0.5)' }}
                          axisLine={false} tickLine={false} hide={isCatOnly}
                          tickFormatter={config.yAxisLeftFormat ? v => formatYValue(v, config.yAxisLeftFormat!) : undefined} />
                        {hasRightAxis && (
                          <YAxis yAxisId="right" orientation="right"
                            tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground) / 0.5)' }}
                            axisLine={false} tickLine={false}
                            tickFormatter={config.yAxisRightFormat ? v => formatYValue(v, config.yAxisRightFormat!) : undefined} />
                        )}
                        <Tooltip contentStyle={{
                          backgroundColor: 'hsl(var(--card))',
                          border: '1px solid hsl(var(--border) / 0.5)',
                          borderRadius: '10px', fontSize: '11px',
                          boxShadow: 'var(--shadow-medium)',
                        }} />
                        {allY.length > 1 && <Legend wrapperStyle={{ fontSize: '11px', opacity: 0.7 }} />}
                        {lineElements}
                        {shapAreas && buildShapAreaElements(shapAreas)}
                        {refElements}
                        {catOverlays}
                        </ChartComp>
                        );
                      })()}
                    </ResponsiveContainer>
                    {catLegend.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-2 px-1">
                        {catLegend.map((item, i) => (
                          <div key={i} className="flex items-center gap-1.5 text-[11px]">
                            <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: item.color, opacity: 0.5 }} />
                            <span className="font-mono">{item.category}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
