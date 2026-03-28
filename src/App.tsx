import { useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppLayout } from "@/components/AppLayout";
import { useDataStore } from "@/lib/data-store";
import { parseCSV } from "@/lib/csv-parser";
import UploadPage from "./pages/UploadPage";
import OverviewPage from "./pages/OverviewPage";
import DetailPage from "./pages/DetailPage";
import CurvesPage from "./pages/CurvesPage";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

function useAutoReloadData() {
  const { parsedData, fieldConfig, setParsedData } = useDataStore();
  useEffect(() => {
    if (fieldConfig && !parsedData) {
      fetch('/data/data.csv', { method: 'HEAD' })
        .then(res => {
          if (res.ok) {
            return fetch('/data/data.csv')
              .then(r => r.blob())
              .then(blob => parseCSV(new File([blob], 'data.csv', { type: 'text/csv' })))
              .then(data => setParsedData(data));
          }
        })
        .catch(() => {});
    }
  }, [fieldConfig, parsedData, setParsedData]);
}

const App = () => {
  useAutoReloadData();
  return (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AppLayout>
          <Routes>
            <Route path="/" element={<UploadPage />} />
            <Route path="/overview" element={<OverviewPage />} />
            <Route path="/detail/:id" element={<DetailPage />} />
            <Route path="/curves" element={<CurvesPage />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AppLayout>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
  );
};

export default App;
