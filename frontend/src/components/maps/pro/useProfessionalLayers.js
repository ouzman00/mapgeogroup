import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildLayerCatalog, isLayerVisibleAtZoom } from "./layerCatalog";
import { isRemovedCommunesLayer } from "./removedMapLayers";

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function readStorage(key) {
  if (typeof window === "undefined") return null;
  return safeJsonParse(window.localStorage.getItem(key));
}


const BASE_LAYER_STORAGE_KEY = "mapgeo:professional-layers:active-base-layer";
const PRIVATE_LAYER_VISIBILITY_STORAGE_VERSION = 1;

function extractBaseLayerId(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  return value.activeBaseLayerId || value.layerId || value.id || "";
}

function isValidBaseLayerId(catalog, layerId) {
  return Boolean(layerId && catalog.some((layer) => layer.group === "fonds" && layer.id === layerId));
}

function readGlobalBaseLayerId(catalog) {
  const saved = readStorage(BASE_LAYER_STORAGE_KEY);
  const layerId = extractBaseLayerId(saved);
  return isValidBaseLayerId(catalog, layerId) ? layerId : "";
}

function isReadyLayer(layer = {}) {
  return !layer.processing_status || layer.processing_status === "ready";
}

function canActivateLayer(layer = {}) {
  return layer.available !== false && isReadyLayer(layer);
}

function applyActiveBaseLayer(layers, activeBaseLayerId) {
  if (!activeBaseLayerId) return layers;
  return layers.map((layer) => (layer.group === "fonds" ? { ...layer, visible: layer.id === activeBaseLayerId } : layer));
}
function mergeSavedState(catalog, saved) {
  if (!saved) return catalog;
  const privateVisibilityMigrated = Number(saved.privateLayerVisibilityVersion || 0) >= PRIVATE_LAYER_VISIBILITY_STORAGE_VERSION;
  return catalog.map((layer) => {
    const savedLayer = saved.layers?.[layer.id];
    if (!savedLayer) return layer;
    const shouldForcePrivateDefault = layer.privateLayer && layer.defaultVisible === true && !privateVisibilityMigrated;
    return {
      ...layer,
      visible: canActivateLayer(layer) ? (shouldForcePrivateDefault ? true : savedLayer.visible ?? layer.visible) : false,
      order: savedLayer.order ?? layer.order,
      opacity: savedLayer.opacity ?? layer.opacity,
    };
  });
}

function resolveBaseLayerId(catalog, saved) {
  const candidates = [
    readGlobalBaseLayerId(catalog),
    extractBaseLayerId(saved),
    catalog.find((layer) => layer.group === "fonds" && layer.visible)?.id,
    "base-plan",
  ];

  return candidates.find((layerId) => isValidBaseLayerId(catalog, layerId)) || catalog.find((layer) => layer.group === "fonds")?.id || "";
}

export default function useProfessionalLayers({ sigLayers, userKey, mapZoom }) {
  const storageKey = `mapgeo:professional-layers:${userKey || "anonymous"}`;
  const catalog = useMemo(() => buildLayerCatalog(sigLayers), [sigLayers]);

  const [activeBaseLayerId, setActiveBaseLayerId] = useState(() => {
    const saved = readStorage(storageKey);
    return resolveBaseLayerId(catalog, saved);
  });
  const [layers, setLayers] = useState(() => applyActiveBaseLayer(mergeSavedState(catalog, readStorage(storageKey)), activeBaseLayerId));
  const activeBaseLayerIdRef = useRef(activeBaseLayerId);

  useEffect(() => {
    activeBaseLayerIdRef.current = activeBaseLayerId;
  }, [activeBaseLayerId]);

  useEffect(() => {
    const saved = readStorage(storageKey);
    const currentBaseLayerId = activeBaseLayerIdRef.current;
    const nextBaseLayerId = isValidBaseLayerId(catalog, currentBaseLayerId) ? currentBaseLayerId : resolveBaseLayerId(catalog, saved);

    setLayers(applyActiveBaseLayer(mergeSavedState(catalog, saved), nextBaseLayerId));
    if (nextBaseLayerId !== currentBaseLayerId) {
      setActiveBaseLayerId(nextBaseLayerId);
    }
  }, [catalog, storageKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const payload = {
      activeBaseLayerId,
      privateLayerVisibilityVersion: PRIVATE_LAYER_VISIBILITY_STORAGE_VERSION,
      layers: Object.fromEntries(
        layers.map((layer) => [
          layer.id,
          {
            visible: layer.visible,
            order: layer.order,
            opacity: layer.opacity,
          },
        ]),
      ),
    };
    window.localStorage.setItem(storageKey, JSON.stringify(payload));
    window.localStorage.setItem(BASE_LAYER_STORAGE_KEY, JSON.stringify({ activeBaseLayerId }));
  }, [layers, activeBaseLayerId, storageKey]);

  const setBaseLayer = useCallback((layerId) => {
    const validLayerId = isValidBaseLayerId(catalog, layerId) ? layerId : activeBaseLayerIdRef.current;
    if (!validLayerId) return;

    activeBaseLayerIdRef.current = validLayerId;
    setActiveBaseLayerId(validLayerId);
    setLayers((current) => applyActiveBaseLayer(current, validLayerId));
  }, [catalog]);

  const toggleLayer = useCallback((layerId) => {
    setLayers((current) => current.map((layer) => {
      if (layer.id !== layerId) return layer;
      if (!canActivateLayer(layer)) return { ...layer, visible: false };
      return { ...layer, visible: !layer.visible };
    }));
  }, []);

  const updateLayerOpacity = useCallback((layerId, opacity) => {
    const value = Math.min(1, Math.max(0, Number(opacity)));
    setLayers((current) => current.map((layer) => (layer.id === layerId ? { ...layer, opacity: value } : layer)));
  }, []);

  const moveLayer = useCallback((draggedId, targetId) => {
    setLayers((current) => {
      const sorted = [...current].sort((a, b) => a.order - b.order);
      const draggedIndex = sorted.findIndex((layer) => layer.id === draggedId);
      const targetIndex = sorted.findIndex((layer) => layer.id === targetId);
      if (draggedIndex < 0 || targetIndex < 0) return current;
      const [dragged] = sorted.splice(draggedIndex, 1);
      sorted.splice(targetIndex, 0, dragged);
      return sorted.map((layer, index) => ({ ...layer, order: index * 10 }));
    });
  }, []);

  const setLayerRuntime = useCallback((layerId, patch) => {
    setLayers((current) => current.map((layer) => (layer.id === layerId ? { ...layer, ...patch } : layer)));
  }, []);

  const layersWithRuntime = useMemo(
    () =>
      layers
        .map((layer) => {
          const activable = canActivateLayer(layer);
          return { ...layer, visible: activable ? layer.visible : false, available: activable, zoomVisible: activable && isLayerVisibleAtZoom(layer, mapZoom) };
        })
        .sort((a, b) => a.order - b.order),
    [layers, mapZoom],
  );

  const baseLayers = useMemo(() => layersWithRuntime.filter((layer) => layer.group === "fonds"), [layersWithRuntime]);
  const operationalLayers = useMemo(
    () => layersWithRuntime.filter((layer) => layer.group !== "fonds" && !isRemovedCommunesLayer(layer)),
    [layersWithRuntime],
  );
  const visibleOperationalLayers = useMemo(
    () => operationalLayers.filter((layer) => layer.visible && layer.zoomVisible && layer.available !== false),
    [operationalLayers],
  );

  const isLayerEnabled = useCallback(
    (layerId) => {
      const layer = layersWithRuntime.find((item) => item.id === layerId);
      return Boolean(layer && layer.visible !== false && layer.available !== false);
    },
    [layersWithRuntime],
  );

  return {
    layers: layersWithRuntime,
    baseLayers,
    operationalLayers,
    visibleOperationalLayers,
    activeBaseLayerId,
    setBaseLayer,
    toggleLayer,
    updateLayerOpacity,
    moveLayer,
    setLayerRuntime,
    isLayerEnabled,
  };
}
