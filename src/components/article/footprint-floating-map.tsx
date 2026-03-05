"use client";

import { useEffect, useMemo, useState } from "react";

import { ArticleMapPoint } from "@/lib/typecho-types";
import { TravelMapPanel } from "@/components/article/travel-map-panel";

interface FootprintFloatingMapProps {
  points: ArticleMapPoint[];
}

const RIGHT_SAFE_GAP_PX = 0;
const MIN_MAP_WIDTH_PX = 180;

export function FootprintFloatingMap({ points }: FootprintFloatingMapProps) {
  const [panelWidth, setPanelWidth] = useState<number | null>(null);

  useEffect(() => {
    const syncPanelWidth = () => {
      const tocRail = document.querySelector<HTMLElement>("[data-mori-toc-rail]");
      if (!tocRail) {
        setPanelWidth(null);
        return;
      }

      const rect = tocRail.getBoundingClientRect();
      if (!Number.isFinite(rect.left) || rect.width <= 0) {
        setPanelWidth(null);
        return;
      }

      const width = Math.floor(window.innerWidth - Math.round(rect.left) - RIGHT_SAFE_GAP_PX);
      if (width < MIN_MAP_WIDTH_PX) {
        setPanelWidth(null);
        return;
      }

      setPanelWidth(width);
    };

    let rafId = 0;
    const requestSync = () => {
      if (rafId) {
        window.cancelAnimationFrame(rafId);
      }
      rafId = window.requestAnimationFrame(syncPanelWidth);
    };

    requestSync();
    window.addEventListener("resize", requestSync);
    window.addEventListener("scroll", requestSync, { passive: true });

    const observer = new ResizeObserver(() => {
      requestSync();
    });
    observer.observe(document.documentElement);
    const tocRail = document.querySelector<HTMLElement>("[data-mori-toc-rail]");
    if (tocRail) {
      observer.observe(tocRail);
    }

    return () => {
      if (rafId) {
        window.cancelAnimationFrame(rafId);
      }
      window.removeEventListener("resize", requestSync);
      window.removeEventListener("scroll", requestSync);
      observer.disconnect();
    };
  }, []);

  const panelStyle = useMemo(() => {
    if (!panelWidth) {
      return undefined;
    }

    return {
      width: `${panelWidth}px`,
      maxWidth: `${panelWidth}px`,
    };
  }, [panelWidth]);

  if (points.length === 0 || !panelWidth) {
    return null;
  }

  return (
    <div className="mt-5 shrink-0" data-mori-footprint-panel="1" style={panelStyle}>
      <TravelMapPanel points={points} mapViewportClassName="h-[clamp(180px,34vh,420px)] aspect-auto" />
    </div>
  );
}
