import L from "leaflet";
import { useEffect, useMemo, useRef } from "react";
import { useMap, useMapEvents } from "react-leaflet";
import { DEFAULT_MAP_CENTER } from "../../../utils/parcelGeometry";
import {
  PORTFOLIO_FALLBACK_ZOOM,
  PORTFOLIO_MAX_ZOOM,
  SELECTION_FALLBACK_ZOOM,
  SELECTION_MAX_ZOOM,
} from "../../../constants/mapConstants";

function isValidPoint(point) {
  if (!Array.isArray(point) || point.length < 2) return false;

  const lat = Number(point[0]);
  const lng = Number(point[1]);

  return Number.isFinite(lat) && Number.isFinite(lng);
}

function normalizePoint(point) {
  if (!isValidPoint(point)) return null;
  return [Number(point[0]), Number(point[1])];
}

function flattenFeaturePoints(feature) {
  if (!feature?.rings) return [];

  return feature.rings
    .flat(3)
    .map(normalizePoint)
    .filter(Boolean);
}

function getSafeMaxZoom(mode) {
  if (mode === "portfolio") {
    return Math.min(PORTFOLIO_MAX_ZOOM || 14, 13);
  }

  return Math.min(SELECTION_MAX_ZOOM || 15, 15);
}

function getSafeFallbackZoom(mode) {
  if (mode === "portfolio") {
    return Math.min(PORTFOLIO_FALLBACK_ZOOM || 13, 13);
  }

  return Math.min(SELECTION_FALLBACK_ZOOM || 15, 15);
}
function getMoveOptions(requestReason) {
  const isInitialMove = requestReason === "initial" || requestReason === "initial_fit";

  if (isInitialMove) {
    return {
      animate: false,
    };
  }

  return {
    animate: true,
    duration: 0.75,
    easeLinearity: 0.35,
  };
}

export function PortfolioViewport({
  mode,
  activeFeature,
  features = [],
  onMapReady,
  viewportRequest,
  onZoomChange,
}) {
  const map = useMap();

  const didInitialFitRef = useRef(false);
  const didDefaultFallbackRef = useRef(false);
  const lastViewportRequestKeyRef = useRef(viewportRequest?.key ?? 0);
  const userMovedMapRef = useRef(false);
  const programmaticMoveRef = useRef(false);

  const points = useMemo(() => {
    if (mode === "portfolio") {
      return features.flatMap((feature) => flattenFeaturePoints(feature));
    }

    return flattenFeaturePoints(activeFeature);
  }, [mode, features, activeFeature]);

  const fallbackCenter = useMemo(() => {
    return (
      normalizePoint(activeFeature?.center) ||
      normalizePoint(features?.[0]?.center) ||
      null
    );
  }, [activeFeature, features]);

  useEffect(() => {
    onMapReady?.(map);
    onZoomChange?.(map.getZoom());

    requestAnimationFrame(() => {
      map.invalidateSize();
    });
  }, [map, onMapReady, onZoomChange]);

  useEffect(() => {
    const syncZoom = () => {
      onZoomChange?.(map.getZoom());
    };

    map.on("zoomend", syncZoom);
    syncZoom();

    return () => {
      map.off("zoomend", syncZoom);
    };
  }, [map, onZoomChange]);

  useEffect(() => {
    const markUserMove = () => {
      if (!programmaticMoveRef.current) {
        userMovedMapRef.current = true;
      }
    };

    map.on("dragstart", markUserMove);
    map.on("zoomstart", markUserMove);

    return () => {
      map.off("dragstart", markUserMove);
      map.off("zoomstart", markUserMove);
    };
  }, [map]);

  useEffect(() => {
    const requestKey = viewportRequest?.key ?? 0;
    const requestReason = viewportRequest?.reason || "initial";

    const isFirstFit = !didInitialFitRef.current;
    const hasExplicitViewportRequest =
      lastViewportRequestKeyRef.current !== requestKey;

    if (!isFirstFit && !hasExplicitViewportRequest) return;

    if (isFirstFit && userMovedMapRef.current && !hasExplicitViewportRequest) {
      return;
    }

    const moveOptions = getMoveOptions(requestReason);
    const maxZoom = getSafeMaxZoom(mode);
    const fallbackZoom = getSafeFallbackZoom(mode);

    const markProgrammaticMove = () => {
      programmaticMoveRef.current = true;

      const release = () => {
        programmaticMoveRef.current = false;
      };

      map.once("moveend", release);
      map.once("zoomend", release);

      window.setTimeout(
        release,
        moveOptions.animate ? 1800 : 250,
      );
    };

    if (points.length >= 3) {
      const bounds = L.latLngBounds(points);

      if (bounds.isValid()) {
        markProgrammaticMove();

        map.fitBounds(bounds, {
          padding: mode === "portfolio" ? [48, 48] : [86, 86],
          maxZoom,
          ...moveOptions,
        });

        didInitialFitRef.current = true;
        lastViewportRequestKeyRef.current = requestKey;
        return;
      }
    }

    if (fallbackCenter) {
      markProgrammaticMove();

      map.setView(fallbackCenter, fallbackZoom, moveOptions);

      didInitialFitRef.current = true;
      lastViewportRequestKeyRef.current = requestKey;
      return;
    }

    if (!didDefaultFallbackRef.current) {
      map.setView(DEFAULT_MAP_CENTER, PORTFOLIO_FALLBACK_ZOOM, {
        animate: false,
      });

      didDefaultFallbackRef.current = true;
    }
  }, [map, mode, activeFeature, features, viewportRequest, points, fallbackCenter]);

  return null;
}

export function MapRuntimeObserver({
  onMouseMove,
  onMapClick,
  onMapDoubleClick,
  onMapContextMenu,
  onMapDragStart,
  onMapDragEnd,
}) {
  useMapEvents({
    mousemove(event) {
      onMouseMove?.([event.latlng.lat, event.latlng.lng]);
    },
    mouseout() {
      onMouseMove?.(null);
    },
    dragstart(event) {
      onMapDragStart?.(event);
    },
    dragend(event) {
      onMapDragEnd?.(event);
    },
    click(event) {
      onMapClick?.([event.latlng.lat, event.latlng.lng], event);
    },
    dblclick(event) {
      onMapDoubleClick?.([event.latlng.lat, event.latlng.lng], event);
    },
    contextmenu(event) {
      event.originalEvent?.preventDefault?.();
      onMapContextMenu?.([event.latlng.lat, event.latlng.lng], event);
    },
  });

  return null;
}