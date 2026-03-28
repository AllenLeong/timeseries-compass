import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useDataStore } from '@/lib/data-store';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, ArrowRight, Check, ChevronDown, Database, Tag, Image, TrendingUp, BarChart3, Clock, FlaskConical, Plus, Trash2, Upload } from 'lucide-react';
import type { ParsedData, FieldConfig, ColumnInfo, PredictionConfig, PredictionMapping, ChartTemplate } from '@/lib/csv-parser';
import { autoDetectConfig, parseListValue } from '@/lib/csv-parser';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface Props {
  data: ParsedData;
  onBack: () => void;
  onConfirm: (config: FieldConfig) => void;
}

function MultiSelect({ 
  options, selected, onChange, max, label 
}: { 
  options: string[]; selected: string[]; onChange: (v: string[]) => void; max?: number; label: string 
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <div
        className="glass-panel px-3 py-2.5 text-sm cursor-pointer flex items-center gap-2 flex-wrap min-h-[40px] transition-all duration-200 hover:bg-secondary/30"
        onClick={() => setOpen(!open)}
      >
        {selected.length === 0 && <span className="text-muted-foreground text-xs">Select...</span>}
        {selected.map(s => (
          <Badge key={s} variant="secondary" className="text-[11px] font-mono py-0.5 px-2 bg-primary/8 border-primary/15">
            {s}
            <button className="ml-1.5 hover:text-destructive transition-colors" onClick={e => { e.stopPropagation(); onChange(selected.filter(x => x !== s)); }}>×</button>
          </Badge>
        ))}
        <ChevronDown className={cn('h-3.5 w-3.5 ml-auto text-muted-foreground shrink-0 transition-transform duration-200', open && 'rotate-180')} />
      </div>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="relative z-10 mt-1.5 w-full glass-elevated max-h-52 overflow-auto p-1.5 rounded-xl"
          >
            {options.map(opt => {
              const isSelected = selected.includes(opt);
              const disabled = !isSelected && max !== undefined && selected.length >= max;
              return (
                <div
                  key={opt}
                  className={cn(
                    'px-2.5 py-2 text-xs font-mono rounded-lg cursor-pointer flex items-center gap-2.5 transition-colors duration-150',
                    isSelected ? 'bg-primary/10 text-primary' : 'hover:bg-secondary/60',
                    disabled && 'opacity-30 cursor-not-allowed'
                  )}
                  onClick={() => {
                    if (disabled) return;
                    onChange(isSelected ? selected.filter(x => x !== opt) : [...selected, opt]);
                  }}
                >
                  <div className={cn(
                    'h-4 w-4 rounded-md border-[1.5px] flex items-center justify-center transition-all duration-150',
                    isSelected ? 'bg-primary border-primary scale-105' : 'border-muted-foreground/30'
                  )}>
                    {isSelected && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                  </div>
                  {opt}
                </div>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function SingleSelect({ options, value, onChange, label, allowEmpty }: {
  options: string[]; value: string; onChange: (v: string) => void; label: string; allowEmpty?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <div className="glass-panel px-3 py-2.5 text-sm cursor-pointer flex items-center gap-2 min-h-[40px] transition-all duration-200 hover:bg-secondary/30" onClick={() => setOpen(!open)}>
        {value ? <span className="font-mono text-xs">{value}</span> : <span className="text-muted-foreground text-xs">Select...</span>}
        <ChevronDown className={cn('h-3.5 w-3.5 ml-auto text-muted-foreground transition-transform duration-200', open && 'rotate-180')} />
      </div>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="relative z-10 mt-1.5 w-full glass-elevated max-h-52 overflow-auto p-1.5 rounded-xl"
          >
            {allowEmpty && (
              <div className="px-2.5 py-2 text-xs rounded-lg cursor-pointer hover:bg-secondary/60 text-muted-foreground transition-colors" onClick={() => { onChange(''); setOpen(false); }}>
                None
              </div>
            )}
            {options.map(opt => (
              <div
                key={opt}
                className={cn('px-2.5 py-2 text-xs font-mono rounded-lg cursor-pointer transition-colors duration-150', opt === value ? 'bg-primary/10 text-primary' : 'hover:bg-secondary/60')}
                onClick={() => { onChange(opt); setOpen(false); }}
              >
                {opt}
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

interface FieldSectionProps {
  icon: React.ReactNode;
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
  action?: React.ReactNode;
}

function FieldSection({ icon, title, description, children, className, action }: FieldSectionProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn('space-y-2', className)}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="text-muted-foreground/70">{icon}</div>
          <div>
            <p className="text-xs font-medium text-foreground/90">{title}</p>
            {description && <p className="text-[10px] text-muted-foreground/60">{description}</p>}
          </div>
        </div>
        {action}
      </div>
      {children}
    </motion.div>
  );
}

export function FieldConfigPanel({ data, onBack, onConfirm }: Props) {
  const existingConfig = useDataStore(s => s.fieldConfig);
  const importConfig = useDataStore(s => s.importConfig);
  const autoConfig = useMemo(() => autoDetectConfig(data.columnInfo), [data.columnInfo]);
  const allHeaders = useMemo(() => new Set(data.headers), [data.headers]);

  // Compute initial/synced values from config + real data
  const computeFromConfig = useCallback((cfg: FieldConfig | null) => {
    const auto = autoConfig;
    const existing = cfg?.columns;
    const filterCols = (cols?: string[]) => (cols || []).filter(c => allHeaders.has(c));
    const filterCol = (col?: string) => (col && allHeaders.has(col)) ? col : '';

    if (!existing) {
      return {
        index: filterCols(auto.index),
        attributes: filterCols(auto.attributes),
        timeseries: filterCols(auto.timeseries),
        categoricalTimeseries: filterCols(auto.categoricalTimeseries),
        name: filterCol(auto.name),
        image: filterCol(auto.image),
        timepoint: filterCol(auto.timepoint),
        timepoint_priority: filterCol(auto.timepoint_priority),
      };
    }

    // When config exists, prefer config values (filtered against real data)
    return {
      index: filterCols(existing.index).length > 0 ? filterCols(existing.index) : filterCols(auto.index),
      name: filterCol(existing.name) || filterCol(auto.name),
      attributes: filterCols(existing.attributes).length > 0 ? filterCols(existing.attributes) : filterCols(auto.attributes),
      image: filterCol(existing.image) || filterCol(auto.image),
      timeseries: filterCols(existing.timeseries).length > 0 ? filterCols(existing.timeseries) : filterCols(auto.timeseries),
      categoricalTimeseries: filterCols(existing.categoricalTimeseries).length > 0 ? filterCols(existing.categoricalTimeseries) : filterCols(auto.categoricalTimeseries),
      timepoint: filterCol(existing.timepoint) || filterCol(auto.timepoint),
      timepoint_priority: filterCol(existing.timepoint_priority) || filterCol(auto.timepoint_priority),
    };
  }, [autoConfig, allHeaders]);

  const computePredFromConfig = useCallback((cfg: FieldConfig | null) => {
    const pred = cfg?.prediction;
    if (!pred) return { timepoint: '', timepointLabels: '', mappings: [] as PredictionMapping[], explanationCols: [] as string[] };
    return {
      timepoint: pred.timepoint && allHeaders.has(pred.timepoint) ? pred.timepoint : '',
      timepointLabels: pred.timepointLabels && allHeaders.has(pred.timepointLabels) ? pred.timepointLabels : '',
      mappings: (pred.predictions || []).filter(m => allHeaders.has(m.predictionCol) && allHeaders.has(m.actualCol)).map(m => ({
        ...m,
        upperBoundCol: m.upperBoundCol && allHeaders.has(m.upperBoundCol) ? m.upperBoundCol : '',
        lowerBoundCol: m.lowerBoundCol && allHeaders.has(m.lowerBoundCol) ? m.lowerBoundCol : '',
      })),
      explanationCols: (pred.explanationCols || []).filter(c => allHeaders.has(c)),
    };
  }, [allHeaders]);

  const initial = useMemo(() => computeFromConfig(existingConfig), [computeFromConfig, existingConfig]);
  const initialPred = useMemo(() => computePredFromConfig(existingConfig), [computePredFromConfig, existingConfig]);
  
  const [indexCols, setIndexCols] = useState<string[]>(initial.index || []);
  const [nameCol, setNameCol] = useState(initial.name || '');
  const [attrCols, setAttrCols] = useState<string[]>(initial.attributes || []);
  const [imageCol, setImageCol] = useState(initial.image || '');
  const [tsCols, setTsCols] = useState<string[]>(initial.timeseries || []);
  const [catTsCols, setCatTsCols] = useState<string[]>(initial.categoricalTimeseries || []);
  const [tpCol, setTpCol] = useState(initial.timepoint || '');

  const [predExpanded, setPredExpanded] = useState(!!existingConfig?.prediction);
  const [predTimepoint, setPredTimepoint] = useState(initialPred.timepoint);
  const [predTimepointLabels, setPredTimepointLabels] = useState(initialPred.timepointLabels);
  const [predMappings, setPredMappings] = useState<PredictionMapping[]>(initialPred.mappings);
  const [predExplanationCols, setPredExplanationCols] = useState<string[]>(initialPred.explanationCols);

  // Track config version to detect imports
  const configVersionRef = useRef(existingConfig?.updated_at ?? existingConfig?.created_at ?? '');

  // Re-sync all form state when config is imported (updated_at changes)
  useEffect(() => {
    const currentVersion = existingConfig?.updated_at ?? existingConfig?.created_at ?? '';
    if (currentVersion && currentVersion !== configVersionRef.current) {
      configVersionRef.current = currentVersion;
      const vals = computeFromConfig(existingConfig);
      setIndexCols(vals.index);
      setNameCol(vals.name);
      setAttrCols(vals.attributes);
      setImageCol(vals.image);
      setTsCols(vals.timeseries);
      setCatTsCols(vals.categoricalTimeseries);
      setTpCol(vals.timepoint);

      const pv = computePredFromConfig(existingConfig);
      setPredExpanded(!!existingConfig?.prediction);
      setPredTimepoint(pv.timepoint);
      setPredTimepointLabels(pv.timepointLabels);
      setPredMappings(pv.mappings);
      setPredExplanationCols(pv.explanationCols);
    }
  }, [existingConfig, computeFromConfig, computePredFromConfig]);

  // Import config handler for use within FieldConfigPanel
  const handleImportConfig = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          importConfig(ev.target?.result as string);
          toast.success('Configuration imported');
        } catch {
          toast.error('Invalid config file');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }, [importConfig]);

  const scalarCols = data.columnInfo.filter(c => c.type === 'scalar').map(c => c.name);
  const listNumCols = data.columnInfo.filter(c => c.type === 'list_num').map(c => c.name);
  const listStrCols = data.columnInfo.filter(c => c.type === 'list_str').map(c => c.name);
  const allListCols = data.columnInfo.filter(c => c.type === 'list_num' || c.type === 'list_str').map(c => c.name);
  const urlCols = data.columnInfo.filter(c => c.type === 'url').map(c => c.name);

  // Columns used in prediction config should be excluded from time series selection
  const predUsedCols = useMemo(() => {
    if (!predExpanded) return new Set<string>();
    const cols = new Set<string>();
    if (predTimepoint) cols.add(predTimepoint);
    if (predTimepointLabels) cols.add(predTimepointLabels);
    for (const m of predMappings) {
      if (m.predictionCol) cols.add(m.predictionCol);
      if (m.upperBoundCol) cols.add(m.upperBoundCol);
      if (m.lowerBoundCol) cols.add(m.lowerBoundCol);
    }
    for (const c of predExplanationCols) {
      if (c) cols.add(c);
    }
    return cols;
  }, [predExpanded, predMappings, predTimepoint, predTimepointLabels, predExplanationCols]);

  const excludedFromTs = useMemo(() => {
    const cols = new Set(predUsedCols);
    if (tpCol) cols.add(tpCol);
    return cols;
  }, [predUsedCols, tpCol]);

  const tsColOptions = useMemo(() => allListCols.filter(c => !excludedFromTs.has(c) && !catTsCols.includes(c)), [allListCols, excludedFromTs, catTsCols]);
  const catTsColOptions = useMemo(() => allListCols.filter(c => c !== tpCol && !tsCols.includes(c)), [allListCols, tpCol, tsCols]);

  // Auto-remove excluded columns from tsCols/catTsCols
  useEffect(() => {
    if (excludedFromTs.size === 0) return;
    setTsCols(prev => {
      const filtered = prev.filter(c => !excludedFromTs.has(c));
      return filtered.length === prev.length ? prev : filtered;
    });
  }, [excludedFromTs]);
  useEffect(() => {
    if (!tpCol) return;
    setCatTsCols(prev => {
      const filtered = prev.filter(c => c !== tpCol);
      return filtered.length === prev.length ? prev : filtered;
    });
  }, [tpCol]);

  const handleSelectAllNumLists = () => {
    const dateKeywords = ['date', 'time', 'idx', 'index'];
    const nonDate = tsColOptions.filter(c => !dateKeywords.some(kw => c.toLowerCase().includes(kw)));
    setTsCols(nonDate);
  };

  const addPredMapping = () => {
    setPredMappings(prev => [...prev, { predictionCol: '', actualCol: '', upperBoundCol: '', lowerBoundCol: '' }]);
  };

  const updatePredMapping = (idx: number, field: keyof PredictionMapping, value: string) => {
    setPredMappings(prev => prev.map((m, i) => i === idx ? { ...m, [field]: value } : m));
  };

  const removePredMapping = (idx: number) => {
    setPredMappings(prev => prev.filter((_, i) => i !== idx));
  };

  // Filter template columns against real data headers
  const filterTemplates = (templates: ChartTemplate[]): ChartTemplate[] => {
    const validListCols = new Set([...tsCols, ...catTsCols, tpCol, ...predMappings.flatMap(m => [m.predictionCol, m.actualCol, m.upperBoundCol || '', m.lowerBoundCol || ''].filter(Boolean))]);
    const validScalarCols = new Set(scalarCols);
    const validCols = new Set([...validListCols, ...validScalarCols]);
    
    return templates.map(t => ({
      ...t,
      yAxisLeft: t.yAxisLeft.filter(c => validCols.has(c)),
      yAxisRight: t.yAxisRight.filter(c => validCols.has(c)),
      categoricalCols: t.categoricalCols?.filter(c => validCols.has(c)),
      fillAreas: t.fillAreas?.filter(fa => validCols.has(fa.series1) && validCols.has(fa.series2)),
      referenceLines: t.referenceLines?.map(rl => ({
        ...rl,
        sourceCol: rl.sourceCol && validScalarCols.has(rl.sourceCol) ? rl.sourceCol : undefined,
      })),
      referenceAreas: t.referenceAreas?.map(ra => ({
        ...ra,
        fromSourceCol: ra.fromSourceCol && validScalarCols.has(ra.fromSourceCol) ? ra.fromSourceCol : undefined,
        toSourceCol: ra.toSourceCol && validScalarCols.has(ra.toSourceCol) ? ra.toSourceCol : undefined,
      })),
      seriesConfig: t.seriesConfig ? Object.fromEntries(
        Object.entries(t.seriesConfig).filter(([k]) => validCols.has(k))
      ) : undefined,
    })).filter(t => t.yAxisLeft.length > 0 || t.yAxisRight.length > 0);
  };

  const handleConfirm = () => {
    const hasPrediction = predExpanded && predTimepoint && predMappings.some(m => m.predictionCol && m.actualCol);
    const prediction: PredictionConfig | undefined = hasPrediction ? {
      timepoint: predTimepoint,
      timepointLabels: predTimepointLabels || undefined,
      predictions: predMappings.filter(m => m.predictionCol && m.actualCol),
      explanationCols: predExplanationCols,
    } : undefined;

    const importedTemplates = existingConfig?.templates || [];
    const filteredTemplates = filterTemplates(importedTemplates);

    const config: FieldConfig = {
      version: '1.0',
      columns: {
        index: indexCols,
        name: nameCol,
        attributes: attrCols,
        image: imageCol,
        timeseries: tsCols,
        categoricalTimeseries: catTsCols,
        timepoint: tpCol,
        timepoint_priority: tpCol,
      },
      prediction,
      templates: filteredTemplates,
      created_at: existingConfig?.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    onConfirm(config);
  };

  const typeLabel = (t: ColumnInfo['type']) => {
    switch (t) {
      case 'list_num': return 'list[num]';
      case 'list_str': return 'list[str]';
      default: return t;
    }
  };

  const typeColor = (t: ColumnInfo['type']) => {
    switch (t) {
      case 'list_num': return 'text-blue-500 dark:text-blue-400';
      case 'list_str': return 'text-emerald-500 dark:text-emerald-400';
      case 'url': return 'text-violet-500 dark:text-violet-400';
      default: return 'text-muted-foreground';
    }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="h-[calc(100vh-3rem)] overflow-auto">
      <div className="max-w-5xl mx-auto px-6 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={onBack} className="h-8 w-8 rounded-xl">
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h2 className="text-lg font-semibold tracking-tight">Field Configuration</h2>
              <p className="text-xs text-muted-foreground/70 mt-0.5">
                {data.rows.length.toLocaleString()} rows · {data.headers.length} columns
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleImportConfig} className="text-xs gap-1.5 rounded-xl">
              <Upload className="h-3 w-3" />
              Import Config
            </Button>
            <Button onClick={handleConfirm} disabled={!nameCol || indexCols.length === 0} className="rounded-xl px-5">
              Continue
              <ArrowRight className="h-4 w-4 ml-1.5" />
            </Button>
          </div>
        </div>

        {/* Detected columns - compact inline */}
        <div className="mb-6">
          <p className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-widest mb-2">Detected Schema</p>
          <div className="flex flex-wrap gap-1">
            {data.columnInfo.map(c => (
              <span key={c.name} className="inline-flex items-center gap-1 text-[11px] font-mono px-2 py-1 rounded-lg bg-secondary/40">
                {c.name}
                <span className={cn('text-[10px]', typeColor(c.type))}>
                  {typeLabel(c.type)}
                </span>
              </span>
            ))}
          </div>
        </div>

        {/* Main config - two column layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* Left: Identity & Metadata */}
          <div className="glass-panel rounded-2xl p-5 space-y-5">
            <p className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-widest">Identity & Metadata</p>
            
            <FieldSection icon={<Database className="h-3.5 w-3.5" />} title="Index Columns" description="Primary keys, max 3">
              <MultiSelect options={scalarCols} selected={indexCols} onChange={setIndexCols} max={3} label="" />
            </FieldSection>

            <FieldSection icon={<Tag className="h-3.5 w-3.5" />} title="Name Column" description="Display name for each row">
              <SingleSelect options={scalarCols} value={nameCol} onChange={setNameCol} label="" />
            </FieldSection>

            <FieldSection icon={<Tag className="h-3.5 w-3.5" />} title="Attributes" description="Additional scalar metadata">
              <MultiSelect options={scalarCols.filter(c => !indexCols.includes(c) && c !== nameCol)} selected={attrCols} onChange={setAttrCols} label="" />
            </FieldSection>

            <FieldSection icon={<Image className="h-3.5 w-3.5" />} title="Image Column" description="URL or path to images">
              <SingleSelect options={[...urlCols, ...scalarCols]} value={imageCol} onChange={setImageCol} label="" allowEmpty />
            </FieldSection>
          </div>

          {/* Right: Time Series */}
          <div className="glass-panel rounded-2xl p-5 space-y-5">
            <p className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-widest">Time Series</p>

            <FieldSection
              icon={<TrendingUp className="h-3.5 w-3.5" />}
              title="Numeric Series"
              description="List columns with numeric values"
              action={
                listNumCols.length > 0 ? (
                  <button onClick={handleSelectAllNumLists} className="text-[10px] text-primary hover:text-primary/80 transition-colors font-medium">
                    Select all
                  </button>
                ) : undefined
              }
            >
              <MultiSelect options={tsColOptions} selected={tsCols} onChange={setTsCols} label="" />
            </FieldSection>

            {catTsColOptions.length > 0 && (
              <FieldSection icon={<BarChart3 className="h-3.5 w-3.5" />} title="Categorical Series" description="List columns with string categories">
                <MultiSelect options={catTsColOptions} selected={catTsCols} onChange={setCatTsCols} label="" />
              </FieldSection>
            )}

            <FieldSection icon={<Clock className="h-3.5 w-3.5" />} title="Time Point Column" description="X-axis reference for series">
              <SingleSelect options={allListCols} value={tpCol} onChange={setTpCol} label="" allowEmpty />
            </FieldSection>
          </div>
        </div>

        {/* Prediction Config - Collapsible */}
        <div className="mb-8">
          <div
            className="glass-panel rounded-2xl overflow-visible transition-all duration-200"
          >
            <button
              className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-secondary/20 transition-colors"
              onClick={() => setPredExpanded(!predExpanded)}
            >
              <FlaskConical className="h-4 w-4 text-muted-foreground/70" />
              <div className="flex-1">
                <p className="text-xs font-semibold text-foreground/90">Prediction Configuration</p>
                <p className="text-[10px] text-muted-foreground/60">Configure forecast data, intervals and explanations</p>
              </div>
              {predMappings.filter(m => m.predictionCol && m.actualCol).length > 0 && (
                <Badge variant="secondary" className="text-[10px] mr-2">
                  {predMappings.filter(m => m.predictionCol && m.actualCol).length} mapped
                </Badge>
              )}
              <ChevronDown className={cn('h-4 w-4 text-muted-foreground/50 transition-transform duration-200', predExpanded && 'rotate-180')} />
            </button>
            <AnimatePresence>
              {predExpanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  style={{ overflow: 'visible' }}
                >
                  <div className="px-5 pb-5 space-y-5 border-t border-border/30 pt-4">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                      <FieldSection icon={<Clock className="h-3.5 w-3.5" />} title="Prediction Time Points" description="List column with forecast time indices">
                        <SingleSelect options={allListCols} value={predTimepoint} onChange={setPredTimepoint} label="" allowEmpty />
                      </FieldSection>

                      <FieldSection icon={<Tag className="h-3.5 w-3.5" />} title="Time Point Labels" description="Optional display labels for time points">
                        <SingleSelect options={allListCols} value={predTimepointLabels} onChange={setPredTimepointLabels} label="" allowEmpty />
                      </FieldSection>
                    </div>

                    {/* Prediction Mappings */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-xs font-medium text-foreground/90">Prediction ↔ Actual Mapping</p>
                          <p className="text-[10px] text-muted-foreground/60">Map each prediction column to its actual column, with optional bounds</p>
                        </div>
                        <Button variant="ghost" size="sm" onClick={addPredMapping} className="h-7 text-[11px] gap-1 px-2">
                          <Plus className="h-3 w-3" /> Add
                        </Button>
                      </div>
                      {predMappings.map((mapping, idx) => (
                        <motion.div
                          key={idx}
                          initial={{ opacity: 0, y: -4 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="grid grid-cols-[1fr_1fr_1fr_1fr_auto] gap-2 items-end"
                        >
                          <div>
                            <p className="text-[10px] text-muted-foreground/60 mb-1">Prediction</p>
                            <SingleSelect options={listNumCols} value={mapping.predictionCol} onChange={v => updatePredMapping(idx, 'predictionCol', v)} label="" />
                          </div>
                          <div>
                            <p className="text-[10px] text-muted-foreground/60 mb-1">Actual</p>
                            <SingleSelect options={tsCols} value={mapping.actualCol} onChange={v => updatePredMapping(idx, 'actualCol', v)} label="" />
                          </div>
                          <div>
                            <p className="text-[10px] text-muted-foreground/60 mb-1">Upper Bound</p>
                            <SingleSelect options={listNumCols} value={mapping.upperBoundCol || ''} onChange={v => updatePredMapping(idx, 'upperBoundCol', v)} label="" allowEmpty />
                          </div>
                          <div>
                            <p className="text-[10px] text-muted-foreground/60 mb-1">Lower Bound</p>
                            <SingleSelect options={listNumCols} value={mapping.lowerBoundCol || ''} onChange={v => updatePredMapping(idx, 'lowerBoundCol', v)} label="" allowEmpty />
                          </div>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0" onClick={() => removePredMapping(idx)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </motion.div>
                      ))}
                      {predMappings.length === 0 && (
                        <p className="text-[11px] text-muted-foreground/40 italic py-2">No mappings yet. Click "Add" to map prediction columns to actuals.</p>
                      )}
                    </div>

                    {/* Explanation Columns */}
                    <FieldSection icon={<BarChart3 className="h-3.5 w-3.5" />} title="Explanation Columns" description="SHAP value columns for feature explanations">
                      <MultiSelect options={listNumCols} selected={predExplanationCols} onChange={setPredExplanationCols} label="" />
                    </FieldSection>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Data Preview */}
        <div className="mb-6">
          <p className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-widest mb-3">Data Preview</p>
          <div className="glass-panel rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b border-white dark:border-white/[0.06]">
                    {data.headers.map(h => (
                      <th key={h} className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 whitespace-nowrap bg-secondary/20 first:rounded-tl-2xl last:rounded-tr-2xl">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.slice(0, 5).map((row, i) => (
                    <tr key={i} className="border-b border-white dark:border-white/[0.06] last:border-0 transition-colors hover:bg-secondary/15">
                      {data.headers.map(h => {
                        const val = String(row[h] ?? '');
                        const truncated = val.length > 50 ? val.slice(0, 50) + '…' : val;
                        return (
                          <td key={h} className="px-4 py-2.5 font-mono text-[11px] text-foreground/75 whitespace-nowrap tabular-nums">
                            {truncated}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Bottom actions */}
        <div className="flex justify-between items-center pb-6">
          <Button variant="ghost" onClick={onBack} className="text-xs text-muted-foreground">
            <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />
            Back
          </Button>
          <Button onClick={handleConfirm} disabled={!nameCol || indexCols.length === 0} className="rounded-xl px-6">
            Confirm Configuration
            <ArrowRight className="h-4 w-4 ml-1.5" />
          </Button>
        </div>
      </div>
    </motion.div>
  );
}
