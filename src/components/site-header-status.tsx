"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";

import { cn } from "@/lib/cn";
import { getRealtimeSocket } from "@/lib/realtime-socket";
import {
  ProcessReporterStatusResponse,
  ProcessReporterStatusSnapshot,
} from "@/lib/process-reporter-types";

const PROCESS_REPORTER_UPDATED_EVENT = "process-reporter:updated";
const PROCESS_REPORTER_WATCH_EVENT = "process-reporter:watch";
const PROCESS_REPORTER_UNWATCH_EVENT = "process-reporter:unwatch";
const PROCESS_REPORTER_POLL_INTERVAL_MS = 10000;

type ViewportMode = "any" | "desktop" | "mobile";

function formatProcessReporterStatus(snapshot: ProcessReporterStatusSnapshot | null, stale: boolean) {
  if (!snapshot || stale) {
    return "💤";
  }

  const parts: string[] = [];
  if (snapshot.process) {
    parts.push(snapshot.process);
  }
  if (snapshot.mediaTitle) {
    const media = snapshot.mediaArtist
      ? `${snapshot.mediaTitle} - ${snapshot.mediaArtist}`
      : snapshot.mediaTitle;
    parts.push(`♪ ${media}`);
  }
  if (parts.length === 0 && snapshot.description) {
    parts.push(snapshot.description);
  }
  if (parts.length === 0) {
    return "在线";
  }

  const text = parts.join(" · ");
  return text.length > 56 ? `${text.slice(0, 56)}...` : text;
}

function isSnapshotStale(snapshot: ProcessReporterStatusSnapshot | null) {
  if (!snapshot) {
    return true;
  }
  return Date.now() > snapshot.staleAt;
}

function AnimatedText({ text }: { text: string }) {
  return (
    <span className="relative inline-flex min-w-0">
      <AnimatePresence initial={false} mode="wait">
        <motion.span
          key={text}
          initial={{ opacity: 0, y: 4, filter: "blur(2px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          exit={{ opacity: 0, y: -4, filter: "blur(2px)" }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          className="block truncate"
        >
          {text}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

function SiteHeaderStatusBase({ viewport }: { viewport: ViewportMode }) {
  const [snapshot, setSnapshot] = useState<ProcessReporterStatusSnapshot | null>(null);
  const [stale, setStale] = useState(true);
  const [featureEnabled, setFeatureEnabled] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const [ownerName, setOwnerName] = useState("站长");
  const [mediaActive, setMediaActive] = useState(viewport === "any");
  const active = viewport === "any" ? true : mediaActive;

  useEffect(() => {
    if (viewport === "any") {
      return;
    }

    const query = viewport === "desktop" ? "(min-width: 768px)" : "(max-width: 767px)";
    const media = window.matchMedia(query);
    const sync = () => setMediaActive(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => {
      media.removeEventListener("change", sync);
    };
  }, [viewport]);

  useEffect(() => {
    if (!active) {
      return;
    }

    let disposed = false;
    let staleTimer = 0;
    let socketRef: Awaited<ReturnType<typeof getRealtimeSocket>> | null = null;

    const applySnapshot = (next: ProcessReporterStatusSnapshot | null) => {
      if (disposed) {
        return;
      }
      setSnapshot(next);
      setStale(isSnapshotStale(next));

      if (staleTimer) {
        window.clearTimeout(staleTimer);
        staleTimer = 0;
      }

      if (!next) {
        return;
      }

      const delay = next.staleAt - Date.now();
      if (delay <= 0) {
        setStale(true);
        return;
      }

      staleTimer = window.setTimeout(() => {
        if (!disposed) {
          setStale(true);
        }
      }, delay);
    };

    type PullResult = "enabled" | "disabled" | "unknown";

    const pullSnapshot = async (): Promise<PullResult> => {
      try {
        const response = await fetch("/api/process-reporter", {
          method: "GET",
          cache: "no-store",
        });
        if (!response.ok) {
          return "unknown";
        }

        const payload = (await response.json()) as ProcessReporterStatusResponse;
        if (!payload.ok) {
          return "unknown";
        }

        const nextOwnerName =
          typeof payload.ownerName === "string" && payload.ownerName.trim()
            ? payload.ownerName.trim()
            : "站长";
        setOwnerName(nextOwnerName);

        if (!payload.enabled) {
          setFeatureEnabled(false);
          applySnapshot(null);
          return "disabled";
        }

        setFeatureEnabled(true);
        applySnapshot(payload.data);
        return "enabled";
      } catch {
        // Keep current state on pull failure.
        return "unknown";
      }
    };

    const setupRealtime = async () => {
      try {
        const socket = await getRealtimeSocket();
        if (disposed) {
          return;
        }

        socketRef = socket;

        const handleUpdated = (payload?: ProcessReporterStatusSnapshot) => {
          if (!payload || typeof payload !== "object") {
            return;
          }
          applySnapshot(payload);
        };

        const handleConnect = () => {
          socket.emit(PROCESS_REPORTER_WATCH_EVENT);
        };

        socket.on(PROCESS_REPORTER_UPDATED_EVENT, handleUpdated);
        socket.on("connect", handleConnect);
        socket.emit(PROCESS_REPORTER_WATCH_EVENT);

        return () => {
          socket.off(PROCESS_REPORTER_UPDATED_EVENT, handleUpdated);
          socket.off("connect", handleConnect);
        };
      } catch {
        return undefined;
      }
    };

    let cleanup: (() => void) | undefined;
    let pollTimer = 0;
    let pollInFlight = false;

    const startPolling = () => {
      if (pollTimer) {
        return;
      }
      pollTimer = window.setInterval(() => {
        if (pollInFlight) {
          return;
        }
        pollInFlight = true;
        void pullSnapshot().finally(() => {
          pollInFlight = false;
        });
      }, PROCESS_REPORTER_POLL_INTERVAL_MS);
    };

    const stopPolling = () => {
      if (!pollTimer) {
        return;
      }
      window.clearInterval(pollTimer);
      pollTimer = 0;
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void pullSnapshot();
      }
    };

    void pullSnapshot().then((result) => {
      if (disposed) {
        return;
      }
      setInitialized(true);
      if (result === "disabled") {
        return;
      }

      void setupRealtime().then((dispose) => {
        cleanup = dispose;
      });

      startPolling();
      document.addEventListener("visibilitychange", handleVisibilityChange);
    });

    return () => {
      disposed = true;
      if (staleTimer) {
        window.clearTimeout(staleTimer);
      }
      stopPolling();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      cleanup?.();
      socketRef?.emit(PROCESS_REPORTER_UNWATCH_EVENT);
    };
  }, [active]);

  const text = useMemo(() => formatProcessReporterStatus(snapshot, stale), [snapshot, stale]);
  const tooltip = `${ownerName}正在使用：${text}`;

  if (!initialized || !featureEnabled) {
    return null;
  }

  return (
    <span
      className="group relative inline-flex max-w-[380px] items-center gap-1.5 font-sans text-xs tracking-[0.4px] text-secondary/85"
      aria-label={tooltip}
      tabIndex={0}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 shrink-0 rounded-full transition-colors duration-300",
          stale ? "bg-secondary/45" : "bg-emerald-500"
        )}
        aria-hidden
      />
      <AnimatedText text={text} />
      {!stale && (
        <span
          className="pointer-events-none absolute bottom-[calc(100%+8px)] left-1/2 z-70 w-max max-w-[min(420px,70vw)] -translate-x-1/2 rounded-md border border-border bg-bg/95 px-2 py-1 text-[11px] leading-tight text-primary opacity-0 shadow-sm transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
          role="tooltip"
        >
          {tooltip}
        </span>
      )}
    </span>
  );
}

export function SiteHeaderStatus() {
  return <SiteHeaderStatusBase viewport="any" />;
}

export function SiteHeaderStatusDesktop() {
  return <SiteHeaderStatusBase viewport="desktop" />;
}

export function SiteHeaderStatusMobile() {
  return <SiteHeaderStatusBase viewport="mobile" />;
}
