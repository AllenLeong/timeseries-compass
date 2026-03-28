import { useCallback, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Upload, Upload as UploadIcon, Database } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { parseCSV, autoDetectConfig } from '@/lib/csv-parser';
import { useDataStore } from '@/lib/data-store';
import { FieldConfigPanel } from '@/components/FieldConfigPanel';
import type { ParsedData, FieldConfig } from '@/lib/csv-parser';
import { motion } from 'framer-motion';
import { toast } from 'sonner';

export default function UploadPage() {
  const navigate = useNavigate();
  const { setParsedData, setFieldConfig, importConfig, fieldConfig, parsedData: globalParsedData } = useDataStore();
  const [parsedData, setLocalParsed] = useState<ParsedData | null>(null);
  const [step, setStep] = useState<'upload' | 'config'>('upload');
  const [dragOver, setDragOver] = useState(false);
  const [loading, setLoading] = useState(false);
  const [hasExistingData, setHasExistingData] = useState(false);

  // Auto-redirect if data and config already exist (e.g. after refresh)
  useEffect(() => {
    if (globalParsedData && fieldConfig) {
      navigate('/overview', { replace: true });
    }
  }, [globalParsedData, fieldConfig, navigate]);

  useEffect(() => {
    fetch('/data/data.csv', { method: 'HEAD' })
      .then(res => { if (res.ok) setHasExistingData(true); })
      .catch(() => {});
  }, []);

  const handleFile = useCallback(async (file: File) => {
    if (!file.name.endsWith('.csv')) {
      toast.error('Please upload a CSV file');
      return;
    }
    setLoading(true);
    try {
      const data = await parseCSV(file);
      setLocalParsed(data);
      setParsedData(data);
      setStep('config');
      toast.success(`Loaded ${data.rows.length} rows, ${data.headers.length} columns`);
    } catch (e) {
      toast.error('Failed to parse CSV file');
    } finally {
      setLoading(false);
    }
  }, [setParsedData]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleUseExisting = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/data/data.csv');
      const blob = await res.blob();
      const file = new File([blob], 'data.csv', { type: 'text/csv' });
      await handleFile(file);
    } catch {
      toast.error('Failed to load existing data');
      setLoading(false);
    }
  }, [handleFile]);

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

  if (step === 'config' && parsedData) {
    return (
      <FieldConfigPanel
        data={parsedData}
        onBack={() => setStep('upload')}
        onConfirm={(config) => {
          setFieldConfig(config);
          navigate('/overview');
        }}
      />
    );
  }

  return (
    <div className="flex items-center justify-center h-[calc(100vh-3rem)] p-8">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 25 }}
        className="w-full max-w-lg"
      >
        <div className="text-center mb-8">
          <motion.h1
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1, type: 'spring', stiffness: 300, damping: 25 }}
            className="text-2xl font-semibold mb-2 tracking-tight"
          >
            DataScope
          </motion.h1>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="text-muted-foreground text-sm"
          >
            Upload a CSV file to explore and analyze your data
          </motion.p>
        </div>

        <motion.div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.99 }}
          className="glass-panel p-14 flex flex-col items-center gap-5 cursor-pointer overflow-hidden"
          style={{
            borderWidth: '1.5px',
            borderStyle: 'dashed',
            borderColor: dragOver ? 'hsl(var(--primary) / 0.5)' : 'hsl(var(--glass-border))',
          }}
          onClick={() => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.csv';
            input.onchange = (e) => {
              const file = (e.target as HTMLInputElement).files?.[0];
              if (file) handleFile(file);
            };
            input.click();
          }}
        >
          {loading ? (
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
              className="h-10 w-10 border-2 border-primary border-t-transparent rounded-full"
            />
          ) : (
            <>
              <motion.div
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.15, type: 'spring', stiffness: 400, damping: 20 }}
                className="h-16 w-16 rounded-2xl bg-primary/8 flex items-center justify-center"
                style={{ boxShadow: 'var(--shadow-glass-inset)' }}
              >
                <Upload className="h-7 w-7 text-primary/80" />
              </motion.div>
              <div className="text-center">
                <p className="font-medium text-sm">Drop CSV file here or click to browse</p>
                <p className="text-xs text-muted-foreground/50 mt-1.5">Supports UTF-8 and GBK encoding</p>
              </div>
            </>
          )}
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="flex items-center justify-center gap-3 mt-6"
        >
          {hasExistingData && (
            <Button variant="outline" size="sm" onClick={handleUseExisting} className="text-xs gap-1.5">
              <Database className="h-3 w-3" />
              Use Existing Data
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={handleImportConfig} className="text-xs gap-1.5">
            <UploadIcon className="h-3 w-3" />
            Import Config
          </Button>
        </motion.div>
      </motion.div>
    </div>
  );
}
