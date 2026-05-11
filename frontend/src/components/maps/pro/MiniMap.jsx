import { MapContainer, Rectangle, TileLayer, WMSTileLayer, useMap, useMapEvents } from "react-leaflet";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getMapConfig } from "../../../config/mapConfig";

function stopOverlayEvent(event) {
  event?.stopPropagation?.();
}

function ParentMapObserver({ parentMap, onChange }) {
  const sync = useCallback(() => {
    if (!parentMap) return;
    onChange({
      center: parentMap.getCenter(),
      zoom: parentMap.getZoom(),
      bounds: parentMap.getBounds(),
    });
  }, [parentMap, onChange]);

  useEffect(() => {
    if (!parentMap) return undefined;
    sync();
    parentMap.on("moveend zoomend resize", sync);
    return () => parentMap.off("moveend zoomend resize", sync);
  }, [parentMap, sync]);

  return null;
}

function MiniMapViewport({ view }) {
  const map = useMap();
  const miniZoom = useMemo(() => Math.max(2, Math.min(18, Number(view?.zoom || 2) - 5)), [view?.zoom]);

  useEffect(() => {
    if (!view?.center) return;
    map.setView(view.center, miniZoom, { animate: false });
    requestAnimationFrame(() => map.invalidateSize());
  }, [map, miniZoom, view?.center]);

  return null;
}

function MiniMapEvents({ parentMap }) {
  useMapEvents({
    click(event) {
      parentMap?.setView(event.latlng, parentMap.getZoom(), { animate: true });
    },
  });
  return null;
}

function MiniMapBaseLayer({ activeBaseLayer }) {
  const mapConfig = getMapConfig();
  const fallback = mapConfig.vectorTiles;

  if (activeBaseLayer?.type === "wms" && activeBaseLayer.url && activeBaseLayer.layers) {
    return (
      <WMSTileLayer
        url={activeBaseLayer.url}
        layers={activeBaseLayer.layers}
        format={activeBaseLayer.format || "image/png"}
        transparent={activeBaseLayer.transparent !== false}
        opacity={activeBaseLayer.opacity ?? 1}
        maxZoom={18}
        maxNativeZoom={activeBaseLayer.maxNativeZoom ?? activeBaseLayer.maxZoom ?? 18}
        keepBuffer={3}
      />
    );
  }

  const url = activeBaseLayer?.url || fallback.url;
  return (
    <TileLayer
      url={url}
      attribution=""
      opacity={activeBaseLayer?.opacity ?? fallback.opacity ?? 1}
      maxZoom={18}
      maxNativeZoom={activeBaseLayer?.maxNativeZoom ?? fallback.maxNativeZoom ?? 18}
      keepBuffer={3}
      crossOrigin="anonymous"
      updateWhenIdle
    />
  );
}

export default function MiniMap({ parentMap, activeBaseLayer }) {
  const [view, setView] = useState(null);

  return (
    <>
      <ParentMapObserver parentMap={parentMap} onChange={setView} />
      {parentMap && view ? (
        <div
          className="mapgeo-export-hidden pointer-events-auto absolute bottom-4 right-4 z-[900] hidden h-[150px] w-[220px] overflow-hidden rounded-[18px] border border-white/40 bg-white shadow-panel 2xl:block"
          onPointerDown={stopOverlayEvent}
          onMouseDown={stopOverlayEvent}
          onClick={stopOverlayEvent}
          onDoubleClick={stopOverlayEvent}
          onContextMenu={stopOverlayEvent}
        >
          <MapContainer
            center={view.center}
            zoom={Math.max(2, Math.min(18, Number(view.zoom || 2) - 5))}
            minZoom={2}
            maxZoom={18}
            className="h-full w-full"
            zoomControl={false}
            attributionControl={false}
            dragging={false}
            scrollWheelZoom={false}
            doubleClickZoom={false}
            touchZoom={false}
            boxZoom={false}
            keyboard={false}
          >
            <MiniMapViewport view={view} />
            <MiniMapBaseLayer activeBaseLayer={activeBaseLayer} />
            <Rectangle bounds={view.bounds} pathOptions={{ color: "#123B5D", weight: 2, fillOpacity: 0.05 }} />
            <MiniMapEvents parentMap={parentMap} />
          </MapContainer>
        </div>
      ) : null}
    </>
  );
}
