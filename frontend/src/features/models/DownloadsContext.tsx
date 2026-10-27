import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useModels } from "@/features/models/ModelsContext";
import {
  cancelDownload as cancelRequest,
  retryDownload as retryRequest,
  startDownload as startRequest,
  listDownloads,
  subscribeDownloads,
  type Download,
} from "@/features/models/api/downloads";
import { reportError, reportSuccess } from "@/lib/toastManager";

interface DownloadsContextValue {
  downloads: Download[];
  start: (name: string) => Promise<void>;
  cancel: (id: string) => void;
  retry: (id: string) => void;
  /** Opens the models screen on the download tab, prefilled with `name`. */
  requestDownload: (name: string) => void;
  requestedName: string | null;
  clearRequest: () => void;
}

const DownloadsContext = createContext<DownloadsContextValue | null>(null);

const RECONNECT_MS = 2000;

export function DownloadsProvider({ children }: { children: ReactNode }) {
  const { refreshModels, openManage } = useModels();
  const [downloads, setDownloads] = useState<Download[]>([]);
  const [requestedName, setRequestedName] = useState<string | null>(null);
  const statusRef = useRef(new Map<string, string>());
  const refreshRef = useRef(refreshModels);
  useEffect(() => {
    refreshRef.current = refreshModels;
  });

  const apply = useCallback((d: Download, announce: boolean) => {
    const previous = statusRef.current.get(d.id);
    statusRef.current.set(d.id, d.status);
    if (announce && previous !== d.status && d.status === "completed") {
      refreshRef.current();
      reportSuccess(`'${d.name}' is ready to use`);
    }
  }, []);

  const hasActive = downloads.some(
    (d) => d.status === "queued" || d.status === "downloading",
  );

  // Safety net: if the stream stalls or drops the last events, poll while anything is active.
  useEffect(() => {
    if (!hasActive) return;
    const timer = setInterval(() => {
      listDownloads()
        .then((list) => {
          list.forEach((d) => apply(d, true));
          setDownloads(list);
        })
        .catch(() => {});
    }, 2000);
    return () => clearInterval(timer);
  }, [hasActive, apply]);

  useEffect(() => {
    const controller = new AbortController();

    (async () => {
      while (!controller.signal.aborted) {
        try {
          await subscribeDownloads(
            (list) => {
              list.forEach((d) => apply(d, false));
              setDownloads(list);
            },
            (d) => {
              apply(d, true);
              setDownloads((prev) =>
                prev.some((x) => x.id === d.id)
                  ? prev.map((x) => (x.id === d.id ? d : x))
                  : [...prev, d],
              );
            },
            controller.signal,
          );
        } catch {
          // backend not reachable yet or stream dropped: retry below
        }
        if (controller.signal.aborted) return;
        await new Promise((r) => setTimeout(r, RECONNECT_MS));
      }
    })();

    return () => controller.abort();
  }, [apply]);

  const start = useCallback(async (name: string) => {
    try {
      const d = await startRequest(name);
      setDownloads((prev) =>
        prev.some((x) => x.id === d.id) ? prev : [...prev, d],
      );
    } catch (error) {
      reportError([
        error instanceof Error ? error.message : "Could not start the download",
      ]);
    }
  }, []);

  const value: DownloadsContextValue = {
    downloads,
    start,
    cancel: (id) => void cancelRequest(id).catch(() => {}),
    retry: (id) => void retryRequest(id).catch(() => {}),
    requestDownload: (name) => {
      setRequestedName(name);
      openManage();
    },
    requestedName,
    clearRequest: () => setRequestedName(null),
  };

  return (
    <DownloadsContext.Provider value={value}>
      {children}
    </DownloadsContext.Provider>
  );
}

export function useDownloads(): DownloadsContextValue {
  const context = useContext(DownloadsContext);
  if (!context) {
    throw new Error("useDownloads must be used within a DownloadsProvider");
  }
  return context;
}
