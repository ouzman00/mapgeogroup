import L from "leaflet";
import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";

import { normalizeToMultiPolygon, projectedGeometryToWgs84 } from "../../../../utils/geometryIo";
import {
  collectGeometryFromLayerGroup,
  eachGeomanResultLayer,
  findNearestEditableSegment,
  isGeomanCutShape,
  isNearExistingVertex,
  refreshGeomanLayerEdition,
  removeNearestEditableVertex,
  safeDisableGeomanModes,
  scheduleGeomanVertexHandlesRefresh,
} from "../utils/geomanEditing";

export default function InlineParcelEditLayer({
  activeFeature,
  editing,
  geometry,
  onGeometryChange,
  onGeometryGetterChange,
  deleteVertexMode,
  geometryReloadKey,
  mapPanes,
  inlineEditStyle,
  inlineEditEvents,
  stopLeafletDomEvent,
  keepBoundsVisibleWithoutZoom,
  isEditableTextTarget,
}) {
  const map = useMap();
  const groupRef = useRef(null);
  const animationFrameRef = useRef(null);
  const geometryRef = useRef(geometry);
  const onGeometryChangeRef = useRef(onGeometryChange);
  const onGeometryGetterChangeRef = useRef(onGeometryGetterChange);
  const deleteVertexModeRef = useRef(Boolean(deleteVertexMode));
  const reloadGeometryRef = useRef(null);
  const hoveredLatLngRef = useRef(null);
  const layerEditOptionsRef = useRef({
    allowSelfIntersection: false,
    snappable: true,
    snapDistance: 24,
    snapMiddle: true,
    snapSegment: true,
    draggable: false,
    preventMarkerRemoval: false,
    removeLayerBelowMinVertexCount: false,
    panes: {
      vertexPane: "markerPane",
      markerPane: "markerPane",
      layerPane: mapPanes.edit,
    },
  });

  useEffect(() => {
    geometryRef.current = geometry;
    onGeometryChangeRef.current = onGeometryChange;
    onGeometryGetterChangeRef.current = onGeometryGetterChange;
  }, [geometry, onGeometryChange, onGeometryGetterChange]);

  useEffect(() => {
    deleteVertexModeRef.current = Boolean(deleteVertexMode);
  }, [deleteVertexMode]);

  useEffect(() => {
    if (!editing || !activeFeature) return undefined;

    const group = L.featureGroup().addTo(map);
    groupRef.current = group;
    onGeometryGetterChangeRef.current?.(() => collectGeometryFromLayerGroup(group));
    const editRenderer = L.svg({ pane: mapPanes.edit, padding: 0.2 });
    const editOptions = layerEditOptionsRef.current;

    safeDisableGeomanModes(map);

    const syncNow = () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      onGeometryChangeRef.current?.(collectGeometryFromLayerGroup(group));
    };

    const scheduleSync = () => {
      scheduleGeomanVertexHandlesRefresh(map);
      if (animationFrameRef.current) return;
      animationFrameRef.current = requestAnimationFrame(syncNow);
    };

    const cleanupEditableLayer = (layer) => {
      layer.off?.(inlineEditEvents, scheduleSync);
      if (layer.__mapgeoAddVertexHandler) layer.off?.("dblclick", layer.__mapgeoAddVertexHandler);
      if (layer.__mapgeoDeleteVertexHandler) layer.off?.("contextmenu", layer.__mapgeoDeleteVertexHandler);
      layer.__mapgeoAddVertexHandler = null;
      layer.__mapgeoDeleteVertexHandler = null;
      layer.__mapgeoInlineEditRegistered = false;
      layer.pm?.disable?.();
    };

    const removeVertexNear = (latlng, preferredLayer = null) => {
      if (!latlng) return false;
      let changedLayer = null;

      const tryLayer = (layer) => {
        if (changedLayer || layer?.__mapgeoIgnoreGeometry || !(layer instanceof L.Polygon) || layer instanceof L.Rectangle) return;
        const result = removeNearestEditableVertex(map, layer, latlng);
        if (result?.removed) changedLayer = layer;
      };

      if (preferredLayer) tryLayer(preferredLayer);
      if (!changedLayer) group.eachLayer(tryLayer);
      if (!changedLayer) return false;

      refreshGeomanLayerEdition(changedLayer, editOptions);
      syncNow();
      return true;
    };

    const insertVertexOnSegment = (layer, event) => {
      if (deleteVertexModeRef.current) return;
      stopLeafletDomEvent(event);

      const latlng = event?.latlng;
      const nearest = findNearestEditableSegment(map, layer, latlng);
      if (!nearest || isNearExistingVertex(map, nearest.ring, latlng)) return;

      nearest.ring.splice(nearest.insertIndex, 0, L.latLng(latlng.lat, latlng.lng));
      layer.setLatLngs(layer.getLatLngs());
      layer.redraw?.();
      refreshGeomanLayerEdition(layer, editOptions);
      syncNow();
    };

    const registerEditableLayer = (layer) => {
      if (!layer || isGeomanCutShape(layer) || !(layer instanceof L.Polygon) || layer instanceof L.Rectangle) {
        layer?.remove?.();
        return;
      }

      layer.__mapgeoIgnoreGeometry = false;
      if (!group.hasLayer(layer)) group.addLayer(layer);
      layer.options.pmIgnore = false;
      layer.options.pane = mapPanes.edit;
      layer.options.renderer = editRenderer;
      layer.options.interactive = true;
      layer.options.bubblingMouseEvents = false;
      layer.setStyle?.({ ...inlineEditStyle, renderer: editRenderer });

      try {
        L.PM?.reInitLayer?.(layer);
      } catch (error) {
        console.warn("Impossible de réinitialiser la couche Geoman.", error);
      }

      layer.pm?.enable?.(editOptions);
      scheduleGeomanVertexHandlesRefresh(map);

      if (layer.__mapgeoInlineEditRegistered) return;
      layer.__mapgeoInlineEditRegistered = true;
      const addVertexHandler = (event) => insertVertexOnSegment(layer, event);
      const deleteVertexHandler = (event) => {
        if (!deleteVertexModeRef.current) return;
        stopLeafletDomEvent(event);
        removeVertexNear(event?.latlng, layer);
      };
      layer.__mapgeoAddVertexHandler = addVertexHandler;
      layer.__mapgeoDeleteVertexHandler = deleteVertexHandler;
      layer.on("dblclick", addVertexHandler);
      layer.on("contextmenu", deleteVertexHandler);
      layer.on(inlineEditEvents, scheduleSync);
    };

    const loadGeometryIntoGroup = (nextGeometry, { keepVisible = false, sync = true } = {}) => {
      const layers = [];
      group.eachLayer((layer) => layers.push(layer));
      layers.forEach(cleanupEditableLayer);
      group.clearLayers();

      const source = normalizeToMultiPolygon(nextGeometry === undefined ? activeFeature.parcel?.geometry : nextGeometry);
      const sourceForLeaflet = projectedGeometryToWgs84(source);
      if (sourceForLeaflet) {
        L.geoJSON(sourceForLeaflet, {
          pane: mapPanes.edit,
          renderer: editRenderer,
          interactive: true,
          style: { ...inlineEditStyle, renderer: editRenderer },
          pmIgnore: false,
        }).eachLayer((layer) => {
          registerEditableLayer(layer);
        });

        if (keepVisible) keepBoundsVisibleWithoutZoom(map, group.getBounds());
      }

      if (sync) syncNow();
    };

    reloadGeometryRef.current = (nextGeometry) => {
      loadGeometryIntoGroup(nextGeometry, { keepVisible: false, sync: false });
      scheduleGeomanVertexHandlesRefresh(map);
    };
    loadGeometryIntoGroup(geometryRef.current || activeFeature.parcel?.geometry, { keepVisible: true, sync: true });
    scheduleGeomanVertexHandlesRefresh(map);

    map.pm?.setGlobalOptions?.({
      continueDrawing: false,
      snappable: true,
      snapDistance: 24,
      snapMiddle: true,
      snapSegment: true,
      allowSelfIntersection: false,
      finishOn: "dblclick",
      templineStyle: { color: "#2563eb", weight: 3, pane: mapPanes.edit },
      hintlineStyle: { color: "#2563eb", dashArray: "6 6", weight: 2, pane: mapPanes.edit },
      pathOptions: inlineEditStyle,
    });
    map.pm?.removeControls?.();

    const doubleClickZoomWasEnabled = map.doubleClickZoom?.enabled?.() ?? false;
    map.doubleClickZoom?.enable?.();

    const handleCreate = (event) => {
      stopLeafletDomEvent(event);
      if (isGeomanCutShape(event)) {
        event?.layer?.remove?.();
        return;
      }
      registerEditableLayer(event.layer);
      syncNow();
    };

    const handleRemove = (event) => {
      if (event?.layer) {
        event.layer.__mapgeoIgnoreGeometry = true;
        if (group.hasLayer(event.layer)) group.removeLayer(event.layer);
      }
      syncNow();
    };

    const handleCut = (event) => {
      if (event?.layer) {
        event.layer.__mapgeoIgnoreGeometry = true;
        if (group.hasLayer(event.layer)) group.removeLayer(event.layer);
      }

      eachGeomanResultLayer(event?.resultingLayers || event?.layers || event?.resultingLayer, registerEditableLayer);
      event?.cutLayer?.remove?.();

      syncNow();
    };

    const handleSync = () => scheduleSync();
    const handleGeomanDragStart = () => {
      try { map.dragging?.disable?.(); } catch {}
      scheduleGeomanVertexHandlesRefresh(map);
    };
    const handleGeomanDragEnd = () => {
      try { map.dragging?.enable?.(); } catch {}
      scheduleSync();
    };
    const handleMouseMove = (event) => {
      hoveredLatLngRef.current = event?.latlng || null;
    };
    const handleMouseOut = () => {
      hoveredLatLngRef.current = null;
    };
    const handleKeyDown = (event) => {
      if (!deleteVertexModeRef.current || isEditableTextTarget(event.target)) return;
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      if (!removeVertexNear(hoveredLatLngRef.current)) return;
      event.preventDefault?.();
      event.stopPropagation?.();
    };

    map.on("pm:create", handleCreate);
    map.on("pm:remove", handleRemove);
    map.on("pm:cut", handleCut);
    map.on("pm:markerdragstart pm:dragstart", handleGeomanDragStart);
    map.on("pm:markerdragend pm:dragend", handleGeomanDragEnd);
    map.on("mousemove", handleMouseMove);
    map.on("mouseout", handleMouseOut);
    map.on(inlineEditEvents, handleSync);
    group.on(inlineEditEvents, handleSync);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      reloadGeometryRef.current = null;
      hoveredLatLngRef.current = null;
      map.off("pm:create", handleCreate);
      map.off("pm:remove", handleRemove);
      map.off("pm:cut", handleCut);
      map.off("pm:markerdragstart pm:dragstart", handleGeomanDragStart);
      map.off("pm:markerdragend pm:dragend", handleGeomanDragEnd);
      try { map.dragging?.enable?.(); } catch {}
      map.off("mousemove", handleMouseMove);
      map.off("mouseout", handleMouseOut);
      map.off(inlineEditEvents, handleSync);
      group.off(inlineEditEvents, handleSync);
      window.removeEventListener("keydown", handleKeyDown);
      onGeometryGetterChangeRef.current?.(null);
      group.eachLayer(cleanupEditableLayer);
      safeDisableGeomanModes(map);
      if (doubleClickZoomWasEnabled) map.doubleClickZoom?.enable?.();
      group.remove();
      groupRef.current = null;
    };
  }, [
    activeFeature?.id,
    editing,
    map,
    mapPanes,
    inlineEditStyle,
    inlineEditEvents,
    stopLeafletDomEvent,
    keepBoundsVisibleWithoutZoom,
    isEditableTextTarget,
  ]);

  useEffect(() => {
    if (!editing || !reloadGeometryRef.current) return;
    reloadGeometryRef.current(geometry);
  }, [editing, geometryReloadKey]);

  return null;
}
