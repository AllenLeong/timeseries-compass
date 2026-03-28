import { create } from 'zustand';
import type { ParsedData, FieldConfig, ChartTemplate } from './csv-parser';

export type ColumnFilter =
  | { col: string; type: 'text'; value: string }
  | { col: string; type: 'multiselect'; values: string[] }
  | { col: string; type: 'range'; min?: number; max?: number };

interface ViewState {
  overviewSelectedCols: string[];
  detailSelectedItems: string[];
  overviewSearch: string;
  overviewSortCol: string | null;
  overviewSortDir: 'asc' | 'desc';
  overviewColumnFilters: ColumnFilter[];
}

interface DataStore {
  parsedData: ParsedData | null;
  fieldConfig: FieldConfig | null;
  templates: ChartTemplate[];
  selectedProductIndex: number;
  viewState: ViewState;
  
  setParsedData: (data: ParsedData) => void;
  setFieldConfig: (config: FieldConfig) => void;
  setTemplates: (templates: ChartTemplate[]) => void;
  addTemplate: (template: ChartTemplate) => void;
  updateTemplate: (id: string, template: Partial<ChartTemplate>) => void;
  deleteTemplate: (id: string) => void;
  setSelectedProduct: (index: number) => void;
  setOverviewCols: (cols: string[]) => void;
  setDetailItems: (items: string[]) => void;
  setOverviewSearch: (search: string) => void;
  setOverviewSort: (col: string | null, dir: 'asc' | 'desc') => void;
  setOverviewFilters: (filters: ColumnFilter[]) => void;
  
  exportConfig: () => string;
  importConfig: (json: string) => void;
  reset: () => void;
}

const STORAGE_KEY = 'data-explorer-config';
const VIEW_STATE_KEY = 'data-explorer-view-state';

const DEFAULT_VIEW_STATE: ViewState = {
  overviewSelectedCols: [],
  detailSelectedItems: [],
  overviewSearch: '',
  overviewSortCol: null,
  overviewSortDir: 'asc',
  overviewColumnFilters: [],
};

function saveToStorage(config: FieldConfig) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {}
}

function loadFromStorage(): FieldConfig | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch { return null; }
}

function saveViewState(state: ViewState) {
  try {
    localStorage.setItem(VIEW_STATE_KEY, JSON.stringify(state));
  } catch {}
}

function loadViewState(): ViewState {
  try {
    const stored = localStorage.getItem(VIEW_STATE_KEY);
    return stored ? { ...DEFAULT_VIEW_STATE, ...JSON.parse(stored) } : DEFAULT_VIEW_STATE;
  } catch { return DEFAULT_VIEW_STATE; }
}

export const useDataStore = create<DataStore>((set, get) => ({
  parsedData: null,
  fieldConfig: loadFromStorage(),
  templates: loadFromStorage()?.templates || [],
  selectedProductIndex: 0,
  viewState: loadViewState(),
  
  setParsedData: (data) => set({ parsedData: data }),
  
  setFieldConfig: (config) => {
    saveToStorage(config);
    set({ fieldConfig: config, templates: config.templates || [] });
  },
  
  setTemplates: (templates) => {
    const config = get().fieldConfig;
    if (config) {
      const updated = { ...config, templates, updated_at: new Date().toISOString() };
      saveToStorage(updated);
      set({ templates, fieldConfig: updated });
    } else {
      set({ templates });
    }
  },
  
  addTemplate: (template) => {
    const templates = [...get().templates, template];
    get().setTemplates(templates);
  },
  
  updateTemplate: (id, partial) => {
    const templates = get().templates.map(t => t.id === id ? { ...t, ...partial } : t);
    get().setTemplates(templates);
  },
  
  deleteTemplate: (id) => {
    const templates = get().templates.filter(t => t.id !== id);
    get().setTemplates(templates);
  },
  
  setSelectedProduct: (index) => set({ selectedProductIndex: index }),
  
  setOverviewCols: (cols) => {
    const vs = { ...get().viewState, overviewSelectedCols: cols };
    saveViewState(vs);
    set({ viewState: vs });
  },
  
  setDetailItems: (items) => {
    const vs = { ...get().viewState, detailSelectedItems: items };
    saveViewState(vs);
    set({ viewState: vs });
  },

  setOverviewSearch: (search) => {
    const vs = { ...get().viewState, overviewSearch: search };
    saveViewState(vs);
    set({ viewState: vs });
  },

  setOverviewSort: (col, dir) => {
    const vs = { ...get().viewState, overviewSortCol: col, overviewSortDir: dir };
    saveViewState(vs);
    set({ viewState: vs });
  },

  setOverviewFilters: (filters) => {
    const vs = { ...get().viewState, overviewColumnFilters: filters };
    saveViewState(vs);
    set({ viewState: vs });
  },
  
  exportConfig: () => {
    const { fieldConfig, viewState } = get();
    const exportData = {
      fieldConfig,
      viewState,
    };
    return JSON.stringify(exportData, null, 2);
  },
  
  importConfig: (json) => {
    try {
      const parsed = JSON.parse(json);
      // Support both new format { fieldConfig, viewState } and legacy (raw FieldConfig)
      if (parsed.fieldConfig) {
        get().setFieldConfig(parsed.fieldConfig);
        if (parsed.viewState) {
          const vs = { ...DEFAULT_VIEW_STATE, ...parsed.viewState };
          saveViewState(vs);
          set({ viewState: vs });
        }
      } else {
        // Legacy: raw FieldConfig object
        const config = parsed as FieldConfig;
        get().setFieldConfig(config);
      }
    } catch (e) {
      throw new Error('Invalid config file');
    }
  },
  
  reset: () => {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(VIEW_STATE_KEY);
    set({ parsedData: null, fieldConfig: null, templates: [], selectedProductIndex: 0, viewState: DEFAULT_VIEW_STATE });
  },
}));
