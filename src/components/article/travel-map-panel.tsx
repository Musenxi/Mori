"use client";

import {
  Map as MapLibreMap,
  NavigationControl,
  type GeoJSONSource,
  type LngLatBoundsLike,
  type MapLayerMouseEvent,
  type StyleSpecification,
} from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/cn";
import { type ArticleMapPoint } from "@/lib/typecho-types";

interface TravelMapPanelProps {
  points: ArticleMapPoint[];
  className?: string;
  mapViewportClassName?: string;
}

type MapPointFeatureCollection = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    geometry: {
      type: "Point";
      coordinates: [number, number];
    };
    properties: {
      id: string;
      label: string;
    };
  }>;
};

const OSM_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: [
        "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
        "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
        "https://c.tile.openstreetmap.org/{z}/{x}/{y}.png",
      ],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
      maxzoom: 19,
    },
  },
  layers: [
    {
      id: "osm",
      type: "raster",
      source: "osm",
      minzoom: 0,
      maxzoom: 22,
    },
  ],
};

const POINT_SOURCE_ID = "mori-map-points";
const POINT_LAYER_ID = "mori-map-points-layer";
const ACTIVE_CORE_LAYER_ID = "mori-map-points-active";
const ACTIVE_SWITCH_HYSTERESIS_PX = 24;
const MAP_CLICK_SCROLL_LOCK_MS = 2200;

function buildPointFeatureCollection(points: ArticleMapPoint[]): MapPointFeatureCollection {
  return {
    type: "FeatureCollection",
    features: points.map((point) => ({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [point.lng, point.lat],
      },
      properties: {
        id: point.id,
        label: point.label,
      },
    })),
  };
}

function ensurePointsSourceAndLayers(map: MapLibreMap, points: ArticleMapPoint[]) {
  const data = buildPointFeatureCollection(points);

  const existingSource = map.getSource(POINT_SOURCE_ID);
  if (existingSource) {
    (existingSource as GeoJSONSource).setData(data as never);
  } else {
    map.addSource(POINT_SOURCE_ID, {
      type: "geojson",
      data: data as never,
    });
  }

  if (!map.getLayer(POINT_LAYER_ID)) {
    map.addLayer({
      id: POINT_LAYER_ID,
      type: "circle",
      source: POINT_SOURCE_ID,
      paint: {
        "circle-color": "rgba(234, 235, 238, 0.92)",
        "circle-stroke-color": "rgba(31, 33, 37, 0.72)",
        "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 0, 1, 12, 1.4, 16, 1.8],
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 0, 3.4, 6, 4.8, 12, 6.6, 16, 8],
      },
    } as never);
  }

  if (!map.getLayer(ACTIVE_CORE_LAYER_ID)) {
    map.addLayer({
      id: ACTIVE_CORE_LAYER_ID,
      type: "circle",
      source: POINT_SOURCE_ID,
      filter: ["==", ["get", "id"], "__none__"],
      paint: {
        "circle-color": "#ff6b8a",
        "circle-stroke-color": "rgba(255, 255, 255, 0.95)",
        "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 0, 1.2, 12, 2, 16, 2.6],
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 0, 4.2, 6, 6, 12, 8.6, 16, 10.6],
      },
    } as never);
  }
}

function setActivePointFilter(map: MapLibreMap, pointId: string) {
  const filter = ["==", ["get", "id"], pointId || "__none__"] as const;

  if (map.getLayer(ACTIVE_CORE_LAYER_ID)) {
    map.setFilter(ACTIVE_CORE_LAYER_ID, filter as never);
  }
}

function fitMapToPoints(map: MapLibreMap, points: ArticleMapPoint[]) {
  if (points.length === 0) {
    return;
  }

  if (points.length === 1) {
    const single = points[0];
    map.easeTo({
      center: [single.lng, single.lat],
      zoom: 11,
      duration: 0,
      essential: true,
    });
    return;
  }

  const bounds = points.reduce(
    (acc, point) => {
      const next = acc as [number, number, number, number];
      next[0] = Math.min(next[0], point.lng);
      next[1] = Math.min(next[1], point.lat);
      next[2] = Math.max(next[2], point.lng);
      next[3] = Math.max(next[3], point.lat);
      return next;
    },
    [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY],
  ) as [number, number, number, number];

  const west = bounds[0];
  const south = bounds[1];
  const east = bounds[2];
  const north = bounds[3];

  if (!Number.isFinite(west) || !Number.isFinite(south) || !Number.isFinite(east) || !Number.isFinite(north)) {
    return;
  }

  const mapBounds: LngLatBoundsLike = [
    [west, south],
    [east, north],
  ];

  map.fitBounds(mapBounds, {
    padding: {
      top: 44,
      right: 44,
      bottom: 44,
      left: 44,
    },
    maxZoom: 9.5,
    duration: 0,
    essential: true,
  });
}

export function TravelMapPanel({ points, className, mapViewportClassName }: TravelMapPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const eventsBoundRef = useRef(false);
  const activePointIdRef = useRef("");
  const mapClickScrollLockRef = useRef<{ targetId: string; until: number }>({
    targetId: "",
    until: 0,
  });
  const [activePointId, setActivePointId] = useState(points[0]?.id ?? "");
  const resolvedActivePointId = useMemo(() => {
    if (points.some((point) => point.id === activePointId)) {
      return activePointId;
    }
    return points[0]?.id ?? "";
  }, [activePointId, points]);

  const activePoint = useMemo(
    () => points.find((point) => point.id === resolvedActivePointId) ?? points[0] ?? null,
    [points, resolvedActivePointId],
  );

  useEffect(() => {
    activePointIdRef.current = resolvedActivePointId;
  }, [resolvedActivePointId]);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const defaultCenter: [number, number] = points[0] ? [points[0].lng, points[0].lat] : [114.1694, 22.3193];

    const map = new MapLibreMap({
      container: containerRef.current,
      style: OSM_STYLE,
      center: defaultCenter,
      zoom: points.length > 0 ? 5 : 4,
      attributionControl: false,
    });

    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      eventsBoundRef.current = false;
    };
  }, [points]);

  useEffect(() => {
    const map = mapRef.current;
    const container = containerRef.current;
    if (!map || !container) {
      return;
    }

    let rafId = 0;
    const resizeMap = () => {
      if (rafId) {
        window.cancelAnimationFrame(rafId);
      }
      rafId = window.requestAnimationFrame(() => {
        map.resize();
      });
    };

    resizeMap();

    const observer = new ResizeObserver(() => {
      resizeMap();
    });
    observer.observe(container);
    window.addEventListener("resize", resizeMap);

    return () => {
      if (rafId) {
        window.cancelAnimationFrame(rafId);
      }
      observer.disconnect();
      window.removeEventListener("resize", resizeMap);
    };
  }, [points]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || points.length === 0) {
      return;
    }

    const ensureMapLayers = () => {
      ensurePointsSourceAndLayers(map, points);
      setActivePointFilter(map, activePointIdRef.current || points[0]?.id || "");

      if (!eventsBoundRef.current) {
        const cursorPointer = () => {
          map.getCanvas().style.cursor = "pointer";
        };
        const cursorDefault = () => {
          map.getCanvas().style.cursor = "";
        };
        const clickToAnchor = (event: MapLayerMouseEvent) => {
          const feature = event.features?.[0];
          const pointIdRaw = feature?.properties?.id;
          const pointId = typeof pointIdRaw === "string" ? pointIdRaw : "";
          if (!pointId) {
            return;
          }

          mapClickScrollLockRef.current = {
            targetId: pointId,
            until: performance.now() + MAP_CLICK_SCROLL_LOCK_MS,
          };

          if (pointId !== activePointIdRef.current) {
            setActivePointId(pointId);
          }

          const anchor = document.getElementById(pointId);
          if (anchor) {
            anchor.scrollIntoView({ behavior: "smooth", block: "center" });
          }
        };

        [POINT_LAYER_ID, ACTIVE_CORE_LAYER_ID].forEach((layerId) => {
          map.on("mouseenter", layerId, cursorPointer);
          map.on("mouseleave", layerId, cursorDefault);
          map.on("click", layerId, clickToAnchor);
        });

        eventsBoundRef.current = true;
      }

      fitMapToPoints(map, points);
    };

    if (map.isStyleLoaded()) {
      ensureMapLayers();
    } else {
      map.once("load", ensureMapLayers);
    }
  }, [points]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !resolvedActivePointId) {
      return;
    }

    const applyFilter = () => {
      setActivePointFilter(map, resolvedActivePointId);
    };

    if (map.isStyleLoaded()) {
      applyFilter();
    } else {
      map.once("load", applyFilter);
    }
  }, [resolvedActivePointId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !activePoint) {
      return;
    }

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const focusZoom = points.length > 1 ? 13.2 : 13.8;

    map.easeTo({
      center: [activePoint.lng, activePoint.lat],
      zoom: focusZoom,
      duration: prefersReducedMotion ? 0 : 980,
      essential: true,
    });
  }, [activePoint, points.length]);

  useEffect(() => {
    if (points.length === 0) {
      return;
    }

    let rafId = 0;

    const syncActivePointByScroll = () => {
      rafId = 0;
      const viewportCenter = window.innerHeight * 0.48;
      const lock = mapClickScrollLockRef.current;
      if (lock.targetId) {
        if (performance.now() < lock.until) {
          if (activePointIdRef.current !== lock.targetId) {
            setActivePointId(lock.targetId);
          }

          const lockAnchor = document.getElementById(lock.targetId);
          if (lockAnchor) {
            const rect = lockAnchor.getBoundingClientRect();
            const anchorCenter = rect.top + rect.height * 0.5;
            const distance = Math.abs(anchorCenter - viewportCenter);
            if (distance <= ACTIVE_SWITCH_HYSTERESIS_PX) {
              mapClickScrollLockRef.current = {
                targetId: "",
                until: 0,
              };
            }
          }

          return;
        }

        mapClickScrollLockRef.current = {
          targetId: "",
          until: 0,
        };
      }

      let nearestId = "";
      let nearestDistance = Number.POSITIVE_INFINITY;
      let currentDistance = Number.POSITIVE_INFINITY;

      points.forEach((point) => {
        const element = document.getElementById(point.id);
        if (!element) {
          return;
        }

        const rect = element.getBoundingClientRect();
        const anchorCenter = rect.top + rect.height * 0.5;
        const distance = Math.abs(anchorCenter - viewportCenter);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestId = point.id;
        }

        if (point.id === activePointIdRef.current) {
          currentDistance = distance;
        }
      });

      if (!nearestId || nearestId === activePointIdRef.current) {
        return;
      }

      if (Number.isFinite(currentDistance) && nearestDistance + ACTIVE_SWITCH_HYSTERESIS_PX >= currentDistance) {
        return;
      }

      setActivePointId(nearestId);
    };

    const requestSync = () => {
      if (rafId) {
        return;
      }

      rafId = window.requestAnimationFrame(syncActivePointByScroll);
    };

    requestSync();

    window.addEventListener("scroll", requestSync, { passive: true });
    window.addEventListener("resize", requestSync);

    return () => {
      if (rafId) {
        window.cancelAnimationFrame(rafId);
      }
      window.removeEventListener("scroll", requestSync);
      window.removeEventListener("resize", requestSync);
    };
  }, [points]);

  if (points.length === 0) {
    return null;
  }

  return (
    <section className={cn("overflow-hidden rounded-xl border border-border bg-card", className)} aria-label="足迹地图">
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        <p className="shrink-0 font-serif-cn text-sm tracking-[1px] text-primary">足迹</p>
        {activePoint ? (
          <div className="min-w-0 flex-1">
            <span className="block w-full truncate text-right font-sans text-xs text-secondary" title={activePoint.label}>
              {activePoint.label}
            </span>
          </div>
        ) : null}
      </header>
      <div
        ref={containerRef}
        className={cn("w-full", mapViewportClassName ?? "aspect-square min-[1280px]:aspect-[16/10]")}
      />
    </section>
  );
}
