"use client";

import {
  Map as MapLibreMap,
  NavigationControl,
  type GeoJSONSource,
  type LngLatBoundsLike,
  type MapLayerMouseEvent,
} from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/cn";
import { type ArticleMapPoint, type ArticleMapRoute } from "@/lib/typecho-types";

interface TravelMapPanelProps {
  points: ArticleMapPoint[];
  routes: ArticleMapRoute[];
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

type MapRouteFeatureCollection = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    geometry: {
      type: "LineString";
      coordinates: Array<[number, number]>;
    };
    properties: {
      id: string;
      color: string;
      mode: string;
    };
  }>;
};

const MAPBOX_LIKE_DARK_STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

const ROUTE_SOURCE_ID = "mori-map-routes";
const ROUTE_LAYER_ID = "mori-map-routes-layer";
const ACTIVE_ROUTE_LAYER_ID = "mori-map-routes-active";
const POINT_SOURCE_ID = "mori-map-points";
const POINT_LAYER_ID = "mori-map-points-layer";
const ACTIVE_CORE_LAYER_ID = "mori-map-points-active";
const ACTIVE_SWITCH_HYSTERESIS_PX = 24;
const MAP_CLICK_SCROLL_LOCK_MS = 2200;
const NODE_FOCUS_DISTANCE_PX = 32;
const ROUTE_FOLLOW_ZOOM_DELTA = 2.9;
const ROUTE_FOLLOW_MIN_ZOOM = 8.4;
const ROUTE_FIT_PADDING_PX = 36;
const ROUTE_FIT_MAX_ZOOM = 13.8;
const ROUTE_READING_BAND_TOP_RATIO = 0.32;
const ROUTE_READING_BAND_BOTTOM_RATIO = 0.62;
const ROUTE_READING_BAND_EPSILON_PX = 12;
const ROUTE_RANGE_EDGE_EPSILON_PX = 1;
const CAMERA_CENTER_EPSILON = 0.00005;
const CAMERA_ZOOM_EPSILON = 0.04;

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

function buildRouteFeatureCollection(routes: ArticleMapRoute[]): MapRouteFeatureCollection {
  return {
    type: "FeatureCollection",
    features: routes
      .filter((route) => Array.isArray(route.coordinates) && route.coordinates.length >= 2)
      .map((route) => ({
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: route.coordinates,
        },
        properties: {
          id: route.id,
          color: route.color,
          mode: route.mode,
        },
      })),
  };
}

function ensureRouteSourceAndLayers(map: MapLibreMap, routes: ArticleMapRoute[]) {
  const data = buildRouteFeatureCollection(routes);
  const existingSource = map.getSource(ROUTE_SOURCE_ID);
  if (existingSource) {
    (existingSource as GeoJSONSource).setData(data as never);
  } else {
    map.addSource(ROUTE_SOURCE_ID, {
      type: "geojson",
      data: data as never,
    });
  }

  if (!map.getLayer(ROUTE_LAYER_ID)) {
    map.addLayer({
      id: ROUTE_LAYER_ID,
      type: "line",
      source: ROUTE_SOURCE_ID,
      paint: {
        "line-color": ["coalesce", ["get", "color"], "#ff6b8a"],
        "line-opacity": 0.82,
        "line-width": ["interpolate", ["linear"], ["zoom"], 3, 2.4, 7, 3.8, 12, 5, 16, 7],
      },
      layout: {
        "line-cap": "round",
        "line-join": "round",
      },
    } as never);
  }

  if (!map.getLayer(ACTIVE_ROUTE_LAYER_ID)) {
    map.addLayer({
      id: ACTIVE_ROUTE_LAYER_ID,
      type: "line",
      source: ROUTE_SOURCE_ID,
      filter: ["==", ["get", "id"], "__none__"],
      paint: {
        "line-color": "rgba(255,255,255,0.95)",
        "line-opacity": 0.98,
        "line-width": ["interpolate", ["linear"], ["zoom"], 3, 4, 7, 6.2, 12, 8.4, 16, 11.6],
      },
      layout: {
        "line-cap": "round",
        "line-join": "round",
      },
    } as never);
  }

  // Keep the active route layer below the colored route layer,
  // so the white line appears as an outline instead of an overlay.
  if (map.getLayer(ACTIVE_ROUTE_LAYER_ID) && map.getLayer(ROUTE_LAYER_ID)) {
    map.moveLayer(ACTIVE_ROUTE_LAYER_ID, ROUTE_LAYER_ID);
  }
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

function setActiveRouteFilter(map: MapLibreMap, routeId: string) {
  const filter = ["==", ["get", "id"], routeId || "__none__"] as const;
  if (map.getLayer(ACTIVE_ROUTE_LAYER_ID)) {
    map.setFilter(ACTIVE_ROUTE_LAYER_ID, filter as never);
  }
}

function fitMapToContent(map: MapLibreMap, points: ArticleMapPoint[], routes: ArticleMapRoute[]) {
  const allCoordinates: Array<[number, number]> = [];
  points.forEach((point) => {
    allCoordinates.push([point.lng, point.lat]);
  });
  routes.forEach((route) => {
    route.coordinates.forEach((coordinate) => {
      allCoordinates.push([coordinate[0], coordinate[1]]);
    });
  });

  if (allCoordinates.length === 0) {
    return;
  }

  if (allCoordinates.length === 1) {
    const [lng, lat] = allCoordinates[0];
    map.easeTo({
      center: [lng, lat],
      zoom: 11,
      duration: 0,
      essential: true,
    });
    return;
  }

  const bounds = allCoordinates.reduce(
    (acc, coordinate) => {
      const next = acc as [number, number, number, number];
      next[0] = Math.min(next[0], coordinate[0]);
      next[1] = Math.min(next[1], coordinate[1]);
      next[2] = Math.max(next[2], coordinate[0]);
      next[3] = Math.max(next[3], coordinate[1]);
      return next;
    },
    [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY],
  ) as [number, number, number, number];

  const [west, south, east, north] = bounds;
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

function sampleCoordinateOnRoute(coordinates: Array<[number, number]>, progress: number) {
  if (coordinates.length === 0) {
    return null;
  }

  if (coordinates.length === 1) {
    return coordinates[0];
  }

  const t = Math.max(0, Math.min(1, progress));
  if (t <= 0) {
    return coordinates[0];
  }
  if (t >= 1) {
    return coordinates[coordinates.length - 1];
  }

  const segmentLengths: number[] = [];
  let totalLength = 0;
  for (let index = 1; index < coordinates.length; index += 1) {
    const previous = coordinates[index - 1];
    const current = coordinates[index];
    const length = Math.hypot(current[0] - previous[0], current[1] - previous[1]);
    segmentLengths.push(length);
    totalLength += length;
  }

  if (!Number.isFinite(totalLength) || totalLength <= 0) {
    return coordinates[0];
  }

  const targetDistance = totalLength * t;
  let passed = 0;
  for (let index = 1; index < coordinates.length; index += 1) {
    const length = segmentLengths[index - 1];
    if (passed + length >= targetDistance) {
      const localProgress = length > 0 ? (targetDistance - passed) / length : 0;
      const previous = coordinates[index - 1];
      const current = coordinates[index];
      return [
        previous[0] + (current[0] - previous[0]) * localProgress,
        previous[1] + (current[1] - previous[1]) * localProgress,
      ] as [number, number];
    }
    passed += length;
  }

  return coordinates[coordinates.length - 1];
}

function resolveRouteBounds(coordinates: Array<[number, number]>): LngLatBoundsLike | null {
  if (!Array.isArray(coordinates) || coordinates.length === 0) {
    return null;
  }

  const reduced = coordinates.reduce(
    (acc, current) => {
      const lng = Number(current[0]);
      const lat = Number(current[1]);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
        return acc;
      }
      acc[0] = Math.min(acc[0], lng);
      acc[1] = Math.min(acc[1], lat);
      acc[2] = Math.max(acc[2], lng);
      acc[3] = Math.max(acc[3], lat);
      return acc;
    },
    [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY],
  );

  const [west, south, east, north] = reduced;
  if (!Number.isFinite(west) || !Number.isFinite(south) || !Number.isFinite(east) || !Number.isFinite(north)) {
    return null;
  }

  return [
    [west, south],
    [east, north],
  ];
}

function resolveRouteFitCamera(map: MapLibreMap, route: ArticleMapRoute, fallbackZoom: number) {
  const bounds = resolveRouteBounds(route.coordinates);
  if (!bounds) {
    const fallbackCenter = route.coordinates[0];
    if (!fallbackCenter) {
      return null;
    }
    return {
      center: [fallbackCenter[0], fallbackCenter[1]] as [number, number],
      zoom: fallbackZoom,
    };
  }

  const camera = map.cameraForBounds(bounds, {
    padding: {
      top: ROUTE_FIT_PADDING_PX,
      right: ROUTE_FIT_PADDING_PX,
      bottom: ROUTE_FIT_PADDING_PX,
      left: ROUTE_FIT_PADDING_PX,
    },
    maxZoom: ROUTE_FIT_MAX_ZOOM,
  });

  if (!camera || !Number.isFinite(camera.zoom) || !camera.center) {
    return null;
  }
  const zoom = Number(camera.zoom);
  if (!Number.isFinite(zoom)) {
    return null;
  }

  const centerRaw = camera.center;
  let center: [number, number] | null = null;
  if (Array.isArray(centerRaw) && centerRaw.length >= 2) {
    const lng = Number(centerRaw[0]);
    const lat = Number(centerRaw[1]);
    if (Number.isFinite(lng) && Number.isFinite(lat)) {
      center = [lng, lat];
    }
  } else if (
    typeof centerRaw === "object" &&
    centerRaw !== null &&
    "lng" in centerRaw &&
    "lat" in centerRaw
  ) {
    const lng = Number((centerRaw as { lng: unknown }).lng);
    const lat = Number((centerRaw as { lat: unknown }).lat);
    if (Number.isFinite(lng) && Number.isFinite(lat)) {
      center = [lng, lat];
    }
  }

  if (!center) {
    return null;
  }

  return {
    center,
    zoom,
  };
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function resolveRouteAnchorPointIds(route: ArticleMapRoute, points: ArticleMapPoint[]) {
  const ids: string[] = [];
  const pushByIndex = (index: number) => {
    const normalized = Math.floor(Number(index));
    if (!Number.isFinite(normalized) || normalized < 0 || normalized >= points.length) {
      return;
    }
    const point = points[normalized];
    if (!point) {
      return;
    }
    const previous = ids[ids.length - 1];
    if (previous !== point.id) {
      ids.push(point.id);
    }
  };

  if (Array.isArray(route.pointIndices) && route.pointIndices.length > 0) {
    route.pointIndices.forEach((index) => {
      pushByIndex(index);
    });
  }

  if (ids.length < 2) {
    pushByIndex(route.startIndex);
    pushByIndex(route.endIndex);
  }

  if (ids.length < 2) {
    if (route.startPointId && ids[ids.length - 1] !== route.startPointId) {
      ids.push(route.startPointId);
    }
    if (route.endPointId && ids[ids.length - 1] !== route.endPointId) {
      ids.push(route.endPointId);
    }
  }

  return ids;
}

function projectPointProgressOnRoute(coordinates: Array<[number, number]>, point: [number, number]) {
  if (!Array.isArray(coordinates) || coordinates.length < 2) {
    return 0;
  }

  const segmentLengths: number[] = [];
  let totalLength = 0;
  for (let index = 1; index < coordinates.length; index += 1) {
    const from = coordinates[index - 1];
    const to = coordinates[index];
    const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
    segmentLengths.push(length);
    totalLength += length;
  }

  if (!Number.isFinite(totalLength) || totalLength <= 0) {
    return 0;
  }

  let bestDistanceSquared = Number.POSITIVE_INFINITY;
  let bestProgress = 0;
  let passed = 0;

  for (let index = 1; index < coordinates.length; index += 1) {
    const from = coordinates[index - 1];
    const to = coordinates[index];
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const length = segmentLengths[index - 1];
    const denominator = dx * dx + dy * dy;
    if (!Number.isFinite(length) || length <= 0 || !Number.isFinite(denominator) || denominator <= 0) {
      passed += Math.max(0, length);
      continue;
    }

    const t = clamp01(((point[0] - from[0]) * dx + (point[1] - from[1]) * dy) / denominator);
    const projectedLng = from[0] + dx * t;
    const projectedLat = from[1] + dy * t;
    const distanceSquared = (point[0] - projectedLng) ** 2 + (point[1] - projectedLat) ** 2;
    if (distanceSquared < bestDistanceSquared) {
      bestDistanceSquared = distanceSquared;
      bestProgress = clamp01((passed + length * t) / totalLength);
    }

    passed += length;
  }

  return bestProgress;
}

function resolveRouteProgressByViewportCenter(
  routes: ArticleMapRoute[],
  points: ArticleMapPoint[],
  pointLookup: Map<string, ArticleMapPoint>,
  readingBandTop: number,
  readingBandBottom: number,
  viewportCenter: number,
) {
  let candidate: {
    route: ArticleMapRoute;
    progress: number;
    span: number;
    overlap: number;
    distanceToCenter: number;
    containsCenter: boolean;
  } | null = null;

  for (const route of routes) {
    const anchorIds = resolveRouteAnchorPointIds(route, points);
    if (anchorIds.length < 2) {
      continue;
    }

    const anchors = anchorIds
      .map((anchorId) => {
        const point = pointLookup.get(anchorId);
        const element = document.getElementById(anchorId);
        if (!point || !element) {
          return null;
        }
        const rect = element.getBoundingClientRect();
        return {
          center: rect.top + rect.height * 0.5,
          progress: projectPointProgressOnRoute(route.coordinates, [point.lng, point.lat]),
        };
      })
      .filter((item): item is { center: number; progress: number } => Boolean(item));

    if (anchors.length < 2) {
      continue;
    }

    for (let index = 1; index < anchors.length; index += 1) {
      if (anchors[index].progress < anchors[index - 1].progress) {
        anchors[index].progress = anchors[index - 1].progress;
      }
    }

    const firstAnchor = anchors[0];
    const lastAnchor = anchors[anchors.length - 1];
    const minY = Math.min(firstAnchor.center, lastAnchor.center);
    const maxY = Math.max(firstAnchor.center, lastAnchor.center);
    const containsCenter =
      minY <= viewportCenter + ROUTE_RANGE_EDGE_EPSILON_PX &&
      maxY >= viewportCenter - ROUTE_RANGE_EDGE_EPSILON_PX;
    const overlapStart = Math.max(minY, readingBandTop - ROUTE_READING_BAND_EPSILON_PX);
    const overlapEnd = Math.min(maxY, readingBandBottom + ROUTE_READING_BAND_EPSILON_PX);
    const overlap = Math.max(0, overlapEnd - overlapStart);
    if (!containsCenter && overlap <= 0) {
      continue;
    }

    const effectiveY = Math.max(minY, Math.min(maxY, viewportCenter));
    let progress = anchors[anchors.length - 1].progress;
    for (let index = 1; index < anchors.length; index += 1) {
      const previous = anchors[index - 1];
      const current = anchors[index];
      const segmentMin = Math.min(previous.center, current.center);
      const segmentMax = Math.max(previous.center, current.center);
      if (effectiveY < segmentMin || effectiveY > segmentMax) {
        continue;
      }

      const span = current.center - previous.center;
      const local = span === 0 ? 0 : clamp01((effectiveY - previous.center) / span);
      progress = previous.progress + (current.progress - previous.progress) * local;
      break;
    }

    const distanceToCenter = containsCenter
      ? 0
      : Math.min(Math.abs(viewportCenter - minY), Math.abs(viewportCenter - maxY));
    const span = Math.abs(maxY - minY);

    if (
      !candidate ||
      Number(containsCenter) > Number(candidate.containsCenter) ||
      (containsCenter === candidate.containsCenter && overlap > candidate.overlap + ROUTE_RANGE_EDGE_EPSILON_PX) ||
      (containsCenter === candidate.containsCenter &&
        Math.abs(overlap - candidate.overlap) <= ROUTE_RANGE_EDGE_EPSILON_PX &&
        distanceToCenter + ROUTE_RANGE_EDGE_EPSILON_PX < candidate.distanceToCenter) ||
      (containsCenter === candidate.containsCenter &&
        Math.abs(overlap - candidate.overlap) <= ROUTE_RANGE_EDGE_EPSILON_PX &&
        Math.abs(distanceToCenter - candidate.distanceToCenter) <= ROUTE_RANGE_EDGE_EPSILON_PX &&
        span + ROUTE_RANGE_EDGE_EPSILON_PX < candidate.span)
    ) {
      candidate = {
        route,
        progress,
        span,
        overlap,
        distanceToCenter,
        containsCenter,
      };
    }
  }

  if (!candidate) {
    return null;
  }

  const resolved = candidate;
  return {
    route: resolved.route,
    progress: clamp01(resolved.progress),
  };
}

export function TravelMapPanel({ points, routes, className, mapViewportClassName }: TravelMapPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const eventsBoundRef = useRef(false);
  const activePointIdRef = useRef("");
  const activeRouteIdRef = useRef("");
  const routeFollowingRef = useRef(false);
  const routeViewportStateRef = useRef<{
    routeId: string;
    fitCenter: [number, number] | null;
    fitZoom: number;
  }>({
    routeId: "",
    fitCenter: null,
    fitZoom: ROUTE_FOLLOW_MIN_ZOOM,
  });
  const cameraPoseRef = useRef<{
    center: [number, number] | null;
    zoom: number;
    mode: "route" | "point" | "";
  }>({
    center: null,
    zoom: Number.NaN,
    mode: "",
  });
  const mapClickScrollLockRef = useRef<{ targetId: string; until: number }>({
    targetId: "",
    until: 0,
  });
  const [activePointId, setActivePointId] = useState(points[0]?.id ?? "");
  const [activeRouteId, setActiveRouteId] = useState("");
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
  const pointLookup = useMemo(() => {
    const lookup = new Map<string, ArticleMapPoint>();
    points.forEach((point) => {
      lookup.set(point.id, point);
    });
    return lookup;
  }, [points]);
  const routePointIdSet = useMemo(() => {
    const ids = new Set<string>();
    routes.forEach((route) => {
      resolveRouteAnchorPointIds(route, points).forEach((pointId) => {
        ids.add(pointId);
      });
    });
    return ids;
  }, [points, routes]);
  const focusZoom = points.length > 1 ? 13.2 : 13.8;
  const routeFallbackZoom = Math.max(ROUTE_FOLLOW_MIN_ZOOM, focusZoom - ROUTE_FOLLOW_ZOOM_DELTA);

  const easeCameraIfNeeded = (
    map: MapLibreMap,
    center: [number, number],
    zoom: number,
    duration: number,
    mode: "route" | "point",
  ) => {
    const last = cameraPoseRef.current;
    if (
      last.mode === mode &&
      last.center &&
      Math.abs(last.center[0] - center[0]) <= CAMERA_CENTER_EPSILON &&
      Math.abs(last.center[1] - center[1]) <= CAMERA_CENTER_EPSILON &&
      Math.abs(last.zoom - zoom) <= CAMERA_ZOOM_EPSILON
    ) {
      return;
    }

    map.easeTo({
      center,
      zoom,
      duration,
      essential: true,
    });
    cameraPoseRef.current = {
      center: [center[0], center[1]],
      zoom,
      mode,
    };
  };

  useEffect(() => {
    activePointIdRef.current = resolvedActivePointId;
  }, [resolvedActivePointId]);

  useEffect(() => {
    activeRouteIdRef.current = activeRouteId;
  }, [activeRouteId]);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const defaultCenter: [number, number] = points[0] ? [points[0].lng, points[0].lat] : [114.1694, 22.3193];

    const map = new MapLibreMap({
      container: containerRef.current,
      style: MAPBOX_LIKE_DARK_STYLE,
      center: defaultCenter,
      zoom: points.length > 0 ? 5 : 4,
      attributionControl: false,
    });

    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;
    routeViewportStateRef.current = {
      routeId: "",
      fitCenter: null,
      fitZoom: routeFallbackZoom,
    };
    cameraPoseRef.current = {
      center: defaultCenter,
      zoom: points.length > 0 ? 5 : 4,
      mode: "",
    };

    return () => {
      map.remove();
      mapRef.current = null;
      eventsBoundRef.current = false;
      cameraPoseRef.current = {
        center: null,
        zoom: Number.NaN,
        mode: "",
      };
    };
  }, [points, routeFallbackZoom, routes]);

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
  }, [points, routeFallbackZoom, routes]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || (points.length === 0 && routes.length === 0)) {
      return;
    }

    const ensureMapLayers = () => {
      ensureRouteSourceAndLayers(map, routes);
      ensurePointsSourceAndLayers(map, points);
      setActivePointFilter(map, activePointIdRef.current || points[0]?.id || "");
      setActiveRouteFilter(map, activeRouteIdRef.current);

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
          routeFollowingRef.current = false;
          routeViewportStateRef.current = {
            routeId: "",
            fitCenter: null,
            fitZoom: routeFallbackZoom,
          };
          setActiveRouteId("");

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

      fitMapToContent(map, points, routes);
    };

    if (map.isStyleLoaded()) {
      ensureMapLayers();
    } else {
      map.once("load", ensureMapLayers);
    }
  }, [points, routeFallbackZoom, routes]);

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
    if (!map) {
      return;
    }

    const applyFilter = () => {
      setActiveRouteFilter(map, activeRouteId);
    };

    if (map.isStyleLoaded()) {
      applyFilter();
    } else {
      map.once("load", applyFilter);
    }
  }, [activeRouteId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !activePoint || routeFollowingRef.current || activeRouteIdRef.current) {
      return;
    }

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    easeCameraIfNeeded(
      map,
      [activePoint.lng, activePoint.lat],
      focusZoom,
      prefersReducedMotion ? 0 : 980,
      "point",
    );
  }, [activePoint, focusZoom]);

  useEffect(() => {
    if (points.length === 0) {
      return;
    }

    let rafId = 0;

    const syncActivePointByScroll = () => {
      rafId = 0;
      const map = mapRef.current;
      const viewportTop = 0;
      const viewportBottom = window.innerHeight;
      const viewportCenter = window.innerHeight * 0.48;
      const readingBandTop = window.innerHeight * ROUTE_READING_BAND_TOP_RATIO;
      const readingBandBottom = window.innerHeight * ROUTE_READING_BAND_BOTTOM_RATIO;
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

      if (nearestId && nearestId !== activePointIdRef.current) {
        if (!Number.isFinite(currentDistance) || nearestDistance + ACTIVE_SWITCH_HYSTERESIS_PX < currentDistance) {
          setActivePointId(nearestId);
        }
      }

      const nearestPoint = nearestId ? pointLookup.get(nearestId) ?? null : null;
      const nearestIsStandalonePoint = Boolean(nearestId) && !routePointIdSet.has(nearestId);
      if (nearestIsStandalonePoint && nearestPoint && nearestDistance <= NODE_FOCUS_DISTANCE_PX) {
        routeFollowingRef.current = false;
        routeViewportStateRef.current = {
          routeId: "",
          fitCenter: null,
          fitZoom: routeFallbackZoom,
        };
        if (activeRouteIdRef.current) {
          setActiveRouteId("");
        }
        if (map) {
          const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
          easeCameraIfNeeded(
            map,
            [nearestPoint.lng, nearestPoint.lat],
            focusZoom,
            prefersReducedMotion ? 0 : 320,
            "point",
          );
        }
        return;
      }

      const routeProgress = resolveRouteProgressByViewportCenter(
        routes,
        points,
        pointLookup,
        Math.max(viewportTop, readingBandTop),
        Math.min(viewportBottom, readingBandBottom),
        viewportCenter,
      );
      if (!map || !routeProgress) {
        routeFollowingRef.current = false;
        routeViewportStateRef.current = {
          routeId: "",
          fitCenter: null,
          fitZoom: routeFallbackZoom,
        };
        if (activeRouteIdRef.current) {
          setActiveRouteId("");
        }
        return;
      }

      const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const routeId = routeProgress.route.id;
      if (routeId !== activeRouteIdRef.current) {
        setActiveRouteId(routeId);
      }

      if (routeViewportStateRef.current.routeId !== routeId) {
        const fitCamera = resolveRouteFitCamera(map, routeProgress.route, routeFallbackZoom);
        routeViewportStateRef.current = {
          routeId,
          fitCenter: fitCamera?.center ?? null,
          fitZoom: fitCamera?.zoom ?? routeFallbackZoom,
        };

        if (fitCamera) {
          easeCameraIfNeeded(
            map,
            fitCamera.center,
            fitCamera.zoom,
            prefersReducedMotion ? 0 : 380,
            "route",
          );
        }
      }

      const sampledCenter = sampleCoordinateOnRoute(routeProgress.route.coordinates, routeProgress.progress);
      if (!sampledCenter) {
        routeFollowingRef.current = false;
        if (activeRouteIdRef.current) {
          setActiveRouteId("");
        }
        return;
      }

      if (routeProgress.route.mode !== "walk") {
        routeFollowingRef.current = false;
        const routeFitCenter = routeViewportStateRef.current.fitCenter;
        if (routeFitCenter) {
          easeCameraIfNeeded(
            map,
            routeFitCenter,
            routeViewportStateRef.current.fitZoom,
            prefersReducedMotion ? 0 : 220,
            "route",
          );
        }
        return;
      }

      const shouldFocusNode = nearestDistance <= NODE_FOCUS_DISTANCE_PX;
      if (shouldFocusNode && nearestId) {
        const targetPoint = pointLookup.get(nearestId);
        if (targetPoint) {
          routeFollowingRef.current = false;
          easeCameraIfNeeded(
            map,
            [targetPoint.lng, targetPoint.lat],
            focusZoom,
            prefersReducedMotion ? 0 : 420,
            "point",
          );
          return;
        }
      }

      routeFollowingRef.current = true;
      easeCameraIfNeeded(
        map,
        sampledCenter,
        routeViewportStateRef.current.fitZoom || routeFallbackZoom,
        prefersReducedMotion ? 0 : 220,
        "route",
      );
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
  }, [points, pointLookup, routePointIdSet, routes, focusZoom, routeFallbackZoom]);

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
