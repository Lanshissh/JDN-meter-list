import React, { createContext, ReactNode, useContext, useState } from "react";

export interface ScanEntry {
  data: string;
  timestamp: string;
}

interface ScanHistoryContextType {
  scans: ScanEntry[];
  addScan: (scan: ScanEntry) => void;
  clearScans: () => void;
}

const ScanHistoryContext = createContext<ScanHistoryContextType | undefined>(
  undefined,
);

export const ScanHistoryProvider = ({ children }: { children: ReactNode }) => {
  const [scans, setScans] = useState<ScanEntry[]>([]);

  const addScan = (scan: ScanEntry) => {
    setScans((prev) => [scan, ...prev]);
  };

  const clearScans = () => {
    setScans([]);
  };

  return (
    <ScanHistoryContext.Provider value={{ scans, addScan, clearScans }}>
      {children}
    </ScanHistoryContext.Provider>
  );
};

export const useScanHistory = (): ScanHistoryContextType => {
  const context = useContext(ScanHistoryContext);
  if (!context)
    throw new Error("useScanHistory must be used within ScanHistoryProvider");
  return context;
};