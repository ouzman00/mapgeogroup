import "@geoman-io/leaflet-geoman-free";
import "@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css";
import { useEffect, useMemo, useRef, useState } from "react";
import proj4 from "proj4";
import { useMap } from "react-leaflet";
import {
  Bookmark,
  Crosshair,
  Download,
  FileDown,
  LocateFixed,
  MapPinned,
  Maximize2,
  Printer,
  Ruler,
  RotateCcw,
  Search,
  Share2,
  SquareDashedMousePointer,
} from "lucide-react";
import { COORDINATE_SYSTEMS } from "./layerCatalog";
import { exportMapAsPng } from "./mapExport";
import { formatArea, formatDistance, haversineDistance } from "../../../utils/parcelGeometry";

proj4.defs(
  "EPSG:32628",
  "+proj=utm +zone=28 +datum=WGS84 +units=m +no_defs +type=crs",
);

function formatCursor(position, system) {
  if (!position) return "—";
  const [lat, lng] = position;
  if (system === "EPSG:4326") return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;

  try {
    const [x, y] = proj4("EPSG:4326", system, [lng, lat]);
    return `${Math.round(x)} / ${Math.round(y)}`;
  } catch {
    return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
  }
}

function polygonAreaSquareMeters(latLngs) {
  if (!Array.isArray(latLngs) || latLngs.length < 3) return 0;
  const projected = latLngs
    .map((point) => {
      try {
        return proj4("EPSG:4326", "EPSG:32628", [point.lng, point.lat]);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  if (projected.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < projected.length; i += 1) {
    const [x1, y1] = projected[i];
    const [x2, y2] = projected[(i + 1) % projected.length];
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area / 2);
}

function ToolButton({ icon: Icon, label, onClick, active = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className={`inline-flex items-center gap-2 rounded-2xl border px-3 py-2 text-xs font-semibold transition ${
        active
          ? "border-mapgeo-sand bg-mapgeo-sand text-mapgeo-primary"
          : "border-white/10 bg-white/10 text-white hover:bg-white/10"
      }`}
    >
      <Icon size={15} />
      <span className="hidden 2xl:inline">{label}</span>
    </button>
  );
}

export default function MapToolbox({
  mapContainerRef,
  showSearch = true,
  title,
  searchMode,
  searchValue,
  onSearchModeChange,
  onSearchValueChange,
  onSubmitSearch,
  cursorPosition,
  coordinateSystem,
  onCoordinateSystemChange,
  onResetNorth,
  onOpenPrintOptions,
}) {
  const map = useMap();
  const [measureResult, setMeasureResult] = useState("");
  const [measureMode, setMeasureMode] = useState(null);
  const measurePointsRef = useRef([]);
  const measureModeRef = useRef(null);
  const [bookmarks, setBookmarks] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("mapgeo:bookmarks") || "[]");
    } catch {
      return [];
    }
  });

  useEffect(() => {
    measureModeRef.current = measureMode;
  }, [measureMode]);

  const updateLiveMeasure = (cursorLatLng = null, suffix = "") => {
    const mode = measureModeRef.current;
    const fixedPoints = measurePointsRef.current;
    const previewPoints = cursorLatLng && fixedPoints.length ? [...fixedPoints, cursorLatLng] : fixedPoints;

    if (mode === "distance") {
      const meters = previewPoints.reduce((total, point, index) => {
        if (index === 0) return 0;
        const previous = previewPoints[index - 1];
        return total + haversineDistance([previous.lat, previous.lng], [point.lat, point.lng]);
      }, 0);
      setMeasureResult(`Distance : ${formatDistance(meters)}${suffix}`);
      return;
    }

    if (mode === "surface") {
      if (previewPoints.length < 3) {
        const missingPoints = 3 - previewPoints.length;
        setMeasureResult(`Surface : ajoutez ${missingPoints} point${missingPoints > 1 ? "s" : ""}${suffix}`);
        return;
      }
      setMeasureResult(`Surface : ${formatArea(polygonAreaSquareMeters(previewPoints))}${suffix}`);
    }
  };

  useEffect(() => {
    const syncWorkingLayer = (shape, layer) => {
      if (!layer) return;
      const points = shape === "Polygon" ? layer.getLatLngs()?.[0] || [] : layer.getLatLngs() || [];
      measurePointsRef.current = points;
      updateLiveMeasure(null, " · en cours");
    };

    const handleDrawStart = (event) => {
      if (!["Line", "Polygon"].includes(event.shape)) return;
      measureModeRef.current = event.shape === "Line" ? "distance" : "surface";
      setMeasureMode(measureModeRef.current);
      measurePointsRef.current = [];
      updateLiveMeasure(null, event.shape === "Line" ? " · cliquez le premier point" : " · cliquez le premier sommet");

      const workingLayer = event.workingLayer;
      if (!workingLayer?.on) return;
      const sync = () => syncWorkingLayer(event.shape, workingLayer);
      workingLayer.on("pm:vertexadded", sync);
      workingLayer.on("pm:change", sync);
      workingLayer.on("pm:snapdrag", sync);
    };

    const handleCreate = (event) => {
      const layer = event.layer;
      const shape = event.shape;
      if (!layer) return;

      if (shape === "Line") {
        const points = layer.getLatLngs();
        const meters = points.reduce((total, point, index) => {
          if (index === 0) return 0;
          const previous = points[index - 1];
          return total + haversineDistance([previous.lat, previous.lng], [point.lat, point.lng]);
        }, 0);
        setMeasureResult(`Distance : ${formatDistance(meters)}`);
      }

      if (shape === "Polygon") {
        const ring = layer.getLatLngs()?.[0] || [];
        setMeasureResult(`Surface : ${formatArea(polygonAreaSquareMeters(ring))}`);
      }

      measurePointsRef.current = [];
      measureModeRef.current = null;
      setMeasureMode(null);
    };

    map.on("pm:drawstart", handleDrawStart);
    map.on("pm:create", handleCreate);
    return () => {
      map.off("pm:drawstart", handleDrawStart);
      map.off("pm:create", handleCreate);
    };
  }, [map]);

  useEffect(() => {
    if (!measureMode) return undefined;

    const handleFallbackClick = (event) => {
      const points = measurePointsRef.current;
      const last = points[points.length - 1];
      if (!last || last.lat !== event.latlng.lat || last.lng !== event.latlng.lng) {
        measurePointsRef.current = [...points, event.latlng];
      }
      updateLiveMeasure(null, " · en cours");
    };

    const handleMove = (event) => {
      updateLiveMeasure(event.latlng, " · en cours");
    };

    const handleFinish = () => {
      measurePointsRef.current = [];
      measureModeRef.current = null;
      setMeasureMode(null);
    };

    map.on("click", handleFallbackClick);
    map.on("mousemove", handleMove);
    map.on("dblclick", handleFinish);

    return () => {
      map.off("click", handleFallbackClick);
      map.off("mousemove", handleMove);
      map.off("dblclick", handleFinish);
    };
  }, [map, measureMode]);

  const formattedCursor = useMemo(() => formatCursor(cursorPosition, coordinateSystem), [cursorPosition, coordinateSystem]);

  const locateGps = () => {
    map.locate({ setView: true, maxZoom: 18, enableHighAccuracy: true });
  };

  const startDistanceMeasure = () => {
    if (!map.pm) return;
    map.pm.disableDraw();
    measurePointsRef.current = [];
    measureModeRef.current = "distance";
    setMeasureMode("distance");
    setMeasureResult("Distance : 0 m · cliquez le premier point");
    map.pm.enableDraw("Line", { snappable: true, finishOn: "dblclick" });
  };

  const startAreaMeasure = () => {
    if (!map.pm) return;
    map.pm.disableDraw();
    measurePointsRef.current = [];
    measureModeRef.current = "surface";
    setMeasureMode("surface");
    setMeasureResult("Surface : ajoutez 3 points · cliquez le premier sommet");
    map.pm.enableDraw("Polygon", { snappable: true, finishOn: "dblclick" });
  };

  const toggleFullscreen = async () => {
    const element = mapContainerRef.current;
    if (!element) return;
    if (!document.fullscreenElement) {
      await element.requestFullscreen?.();
      setTimeout(() => map.invalidateSize(), 250);
    } else {
      await document.exitFullscreen?.();
      setTimeout(() => map.invalidateSize(), 250);
    }
  };

  const saveBookmark = () => {
    const center = map.getCenter();
    const bookmark = {
      id: Date.now(),
      label: `${title || "Vue"} · zoom ${map.getZoom()}`,
      center: [center.lat, center.lng],
      zoom: map.getZoom(),
    };
    const next = [bookmark, ...bookmarks].slice(0, 8);
    setBookmarks(next);
    localStorage.setItem("mapgeo:bookmarks", JSON.stringify(next));
  };

  const shareView = async () => {
    const center = map.getCenter();
    const params = new URLSearchParams(window.location.search);
    params.set("lat", center.lat.toFixed(6));
    params.set("lng", center.lng.toFixed(6));
    params.set("zoom", String(map.getZoom()));
    const url = `${window.location.origin}${window.location.pathname}?${params.toString()}`;
    await navigator.clipboard?.writeText(url);
    window.alert("Lien de vue cartographique copié dans le presse-papiers.");
  };

  return (
    <div className="mapgeo-export-hidden absolute bottom-3 left-3 right-3 z-[950] flex max-h-[calc(100%-1.5rem)] max-w-[calc(100%-1.5rem)] flex-col gap-3 overflow-auto sm:bottom-auto sm:right-auto sm:left-4 sm:top-4 sm:max-w-[calc(100%-2rem)]">
      {showSearch ? (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmitSearch?.();
        }}
        className="rounded-[24px] border border-white/10 bg-[#08131d]/92 p-3 text-white shadow-panel backdrop-blur"
      >
        <div className="flex flex-wrap gap-2">
          <select
            value={searchMode}
            onChange={(event) => onSearchModeChange(event.target.value)}
            className="mapgeo-dark-select rounded-2xl border border-white/10 bg-[#123B5D] px-3 py-2 text-xs font-semibold text-white outline-none"
          >
            <option value="reference">Référence parcelle</option>
            <option value="client">Client</option>
            <option value="commune">Commune</option>
          </select>

          <input
            value={searchValue}
            onChange={(event) => onSearchValueChange(event.target.value)}
            placeholder="Rechercher…"
            className="min-w-[220px] rounded-2xl border border-white/10 bg-white/10 px-3 py-2 text-sm text-white outline-none placeholder:text-white/40"
          />

          <button type="submit" className="rounded-2xl bg-mapgeo-sand px-3 py-2 text-xs font-bold text-mapgeo-primary">
            <Search size={15} />
          </button>
        </div>
      </form>
      ) : null}

      <div className="flex flex-wrap gap-2 rounded-[24px] border border-white/10 bg-[#08131d]/92 p-3 shadow-panel backdrop-blur">
        <ToolButton icon={LocateFixed} label="GPS" onClick={locateGps} />
        <ToolButton icon={Ruler} label="Distance" onClick={startDistanceMeasure} active={measureMode === "distance"} />
        <ToolButton icon={SquareDashedMousePointer} label="Surface" onClick={startAreaMeasure} active={measureMode === "surface"} />
        <ToolButton icon={Download} label="PNG" onClick={() => exportMapAsPng(mapContainerRef.current, title)} />
        <ToolButton icon={FileDown} label="PDF" onClick={onOpenPrintOptions || (() => {})} />
        <ToolButton icon={Printer} label="Imprimer la carte" onClick={onOpenPrintOptions || (() => window.print())} />
        <ToolButton icon={Maximize2} label="Plein écran" onClick={toggleFullscreen} />
        <ToolButton icon={Bookmark} label="Signet" onClick={saveBookmark} />
        <ToolButton icon={Share2} label="Partager" onClick={shareView} />
        <ToolButton icon={RotateCcw} label="Nord" onClick={onResetNorth || (() => {})} />
      </div>

      <div className="rounded-[20px] border border-mapgeo-line bg-white/95 px-3 py-2 text-xs font-semibold text-mapgeo-primary shadow-panel">
        <div className="flex flex-wrap items-center gap-3">
          <span>
            <Crosshair size={13} className="mr-1 inline" />
            {formattedCursor}
          </span>
          <select
            value={coordinateSystem}
            onChange={(event) => onCoordinateSystemChange(event.target.value)}
            className="mapgeo-dark-select rounded-xl border border-white/10 bg-[#123B5D]/95 px-2 py-1 text-xs font-semibold text-white"
          >
            {COORDINATE_SYSTEMS.map((system) => (
              <option key={system.id} value={system.id}>
                {system.id} · {system.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {measureResult ? (
        <div className="rounded-[20px] border border-mapgeo-line bg-white/95 px-3 py-2 text-sm font-bold text-mapgeo-primary shadow-panel" aria-live="polite">
          {measureResult}
        </div>
      ) : null}

      {bookmarks.length ? (
        <div className="max-w-[320px] rounded-[20px] border border-white/10 bg-[#08131d]/92 p-3 text-white shadow-panel backdrop-blur">
          <p className="mb-2 text-xs font-bold uppercase tracking-[0.16em] text-mapgeo-sand/75">Signets</p>
          <div className="space-y-1">
            {bookmarks.map((bookmark) => (
              <button
                key={bookmark.id}
                type="button"
                onClick={() => map.setView(bookmark.center, bookmark.zoom)}
                className="block w-full truncate rounded-xl bg-white/10 px-3 py-2 text-left text-xs text-white/75 hover:bg-white/10"
              >
                <MapPinned size={12} className="mr-1 inline" />
                {bookmark.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
