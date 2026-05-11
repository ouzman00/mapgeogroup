import { CircleMarker, Marker, Polygon, TileLayer, Tooltip, WMSTileLayer } from "react-leaflet";
import L from "leaflet";
import { formatDistance, haversineDistance } from "../../utils/parcelGeometry";
import { escapeHtml, getMapConfig } from "../../config/mapConfig";

function createLabelIcon(label) {
  return L.divIcon({
    className: "mapgeo-side-label-shell",
    html: `<span class="mapgeo-side-label">${escapeHtml(label)}</span>`,
    iconSize: [90, 24],
    iconAnchor: [45, 12],
  });
}

function midpoint(a, b) {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

function renderExternalLayer(layer, index) {
  const key = layer.id || layer.name || `sig-${index}`;
  const opacity = typeof layer.opacity === "number" ? Math.min(1, Math.max(0, layer.opacity)) : 1;

  if ((layer.type === "wms" || layer.service === "wms") && layer.url && layer.layers) {
    return (
      <WMSTileLayer
        key={key}
        url={layer.url}
        layers={layer.layers}
        format={layer.format || "image/png"}
        transparent={layer.transparent !== false}
        opacity={opacity}
        attribution={layer.attribution || ""}
      />
    );
  }

  if (layer.url) {
    return (
      <TileLayer
        key={key}
        url={layer.url}
        opacity={opacity}
        attribution={layer.attribution || ""}
        maxZoom={layer.maxZoom ?? 22}
        maxNativeZoom={layer.maxNativeZoom ?? layer.maxZoom ?? 18}
        detectRetina={Boolean(layer.detectRetina)}
      />
    );
  }

  return null;
}

export default function MapLayers({
  rings,
  positions,
  reference,
  baseLayer,
  showVertices,
  showMeasurements,
  showExternalLayers,
  sigLayers,
}) {
  const mapConfig = getMapConfig();
  const validRings = Array.isArray(rings) ? rings.filter((ring) => Array.isArray(ring) && ring.length >= 3) : [];

  const sideMarkers = showMeasurements
    ? validRings.flatMap((ring, ringIndex) =>
        ring.map((point, index) => {
          const nextPoint = ring[(index + 1) % ring.length];
          return {
            id: `side-${ringIndex}-${index}`,
            point: midpoint(point, nextPoint),
            label: formatDistance(haversineDistance(point, nextPoint)),
          };
        }),
      )
    : [];

  return (
    <>
      {baseLayer === "satellite" ? (
        <TileLayer
          attribution={mapConfig.satelliteTiles.attribution}
          url={mapConfig.satelliteTiles.url}
          maxZoom={mapConfig.satelliteTiles.maxZoom ?? 22}
          maxNativeZoom={mapConfig.satelliteTiles.maxNativeZoom ?? 18}
          detectRetina={Boolean(mapConfig.satelliteTiles.detectRetina)}
        />
      ) : (
        <TileLayer
          attribution={mapConfig.vectorTiles.attribution}
          url={mapConfig.vectorTiles.url}
          maxZoom={mapConfig.vectorTiles.maxZoom ?? 22}
          maxNativeZoom={mapConfig.vectorTiles.maxNativeZoom ?? 20}
          detectRetina={Boolean(mapConfig.vectorTiles.detectRetina)}
        />
      )}

      {showExternalLayers ? (sigLayers || []).map(renderExternalLayer) : null}

      {validRings.length >= 1 ? (
        <Polygon positions={positions} pathOptions={{ color: "#123B5D", fillColor: "#C7B299", fillOpacity: 0.18, weight: 3 }}>
          <Tooltip sticky>{reference}</Tooltip>
        </Polygon>
      ) : null}

      {showVertices
        ? validRings.flatMap((ring, ringIndex) =>
            ring.map((point, index) => (
              <CircleMarker
                key={`vertex-${ringIndex}-${index}`}
                center={point}
                radius={6}
                pathOptions={{ color: "#123B5D", fillColor: "#ffffff", fillOpacity: 1, weight: 2 }}
              >
                <Tooltip direction="top" permanent={ring.length <= 8}>
                  {validRings.length > 1 ? `P${ringIndex + 1}-V${index + 1}` : `V${index + 1}`}
                </Tooltip>
              </CircleMarker>
            )),
          )
        : null}

      {showMeasurements
        ? sideMarkers.map((item) => (
            <Marker key={item.id} position={item.point} icon={createLabelIcon(item.label)} interactive={false} />
          ))
        : null}
    </>
  );
}
