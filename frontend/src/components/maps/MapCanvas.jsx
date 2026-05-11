import { useEffect, useRef } from "react";
import { MapContainer, ScaleControl, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { DEFAULT_MAP_CENTER } from "../../utils/parcelGeometry";
import MapLayers from "./MapLayers";

function MapViewport({ rings, center, onMapReady, containerRef }) {
  const map = useMap();

  useEffect(() => {
    onMapReady?.(map);
    requestAnimationFrame(() => map.invalidateSize());
  }, [map, onMapReady]);

  useEffect(() => {
    const container = containerRef?.current;
    if (!container || typeof ResizeObserver === "undefined") return undefined;

    let frameId = null;
    const invalidateMapSize = () => {
      if (frameId) cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(() => {
        map.invalidateSize({ animate: false });
        frameId = null;
      });
    };

    const observer = new ResizeObserver(invalidateMapSize);
    observer.observe(container);
    invalidateMapSize();

    return () => {
      observer.disconnect();
      if (frameId) cancelAnimationFrame(frameId);
    };
  }, [containerRef, map]);

  useEffect(() => {
    const boundsPoints = Array.isArray(rings) ? rings.flat() : [];

    if (boundsPoints.length >= 3) {
      map.fitBounds(boundsPoints, { padding: [32, 32], maxZoom: 18, animate: false });
      return;
    }

    map.setView(center || DEFAULT_MAP_CENTER, 16, { animate: false });
  }, [map, rings, center]);

  return null;
}

export default function MapCanvas({
  rings,
  positions,
  center,
  reference,
  baseLayer,
  showVertices,
  showMeasurements,
  showExternalLayers,
  sigLayers,
  onMapReady,
}) {
  const containerRef = useRef(null);

  return (
    <div ref={containerRef} className="h-full min-h-[420px] overflow-hidden rounded-3xl border border-mapgeo-line bg-white">
      <MapContainer center={center || DEFAULT_MAP_CENTER} zoom={16} className="h-full w-full" zoomControl>
        <MapViewport rings={rings} center={center} onMapReady={onMapReady} containerRef={containerRef} />
        <ScaleControl position="bottomleft" />
        <MapLayers
          rings={rings}
          positions={positions}
          reference={reference}
          baseLayer={baseLayer}
          showVertices={showVertices}
          showMeasurements={showMeasurements}
          showExternalLayers={showExternalLayers}
          sigLayers={sigLayers}
        />
      </MapContainer>
    </div>
  );
}
