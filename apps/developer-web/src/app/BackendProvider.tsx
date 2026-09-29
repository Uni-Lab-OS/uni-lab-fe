import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { createStudioBackend } from "./backend";
import type { StudioBackend } from "./backend";

export type BackendConnection = "unknown" | "connected" | "error";

interface BackendContextValue {
  readonly backend: StudioBackend;
  readonly connection: BackendConnection;
  readonly reportSuccess: () => void;
  readonly reportError: (error: unknown) => void;
}

const BackendContext = createContext<BackendContextValue | null>(null);

export function BackendProvider({ children }: { children: ReactNode }) {
  const backend = useMemo(() => createStudioBackend(), []);
  useEffect(() => () => backend.services.dispose(), [backend]);
  const [connection, setConnection] = useState<BackendConnection>("unknown");
  const reportSuccess = useCallback(() => setConnection("connected"), []);
  const reportError = useCallback(() => setConnection("error"), []);
  const value = useMemo<BackendContextValue>(
    () => ({
      backend,
      connection,
      reportSuccess,
      reportError,
    }),
    [connection, backend, reportError, reportSuccess],
  );
  return (
    <BackendContext.Provider value={value}>{children}</BackendContext.Provider>
  );
}

export function useBackend(): BackendContextValue {
  const context = useContext(BackendContext);
  if (!context) throw new Error("useBackend 必须在 BackendProvider 内使用");
  return context;
}
