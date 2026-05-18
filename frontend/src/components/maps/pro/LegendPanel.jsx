import { AlertTriangle, Check, Loader2, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getAvailableLegendItems } from "../parcelMapStyles";
import mapLayerService from "../../../services/mapLayerService";

function clampNumber(value, fallback, min, max) {
  const number = Number(String(value ?? "").replace(",", "."));
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function colorWithOpacity(color, opacity = 1) {
  const raw = String(color || "").trim();
  if (!raw) return raw;
  if (/^rgba?\(/i.test(raw) || /^hsla?\(/i.test(raw)) return raw;
  const match = raw.match(/^#?([0-9a-f]{6})$/i);
  if (!match) return raw;
  const alpha = clampNumber(opacity, 1, 0, 1);
  const value = match[1];
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function isLegendImageItem(item = {}) {
  return Boolean(
    item?.symbol === "wms-legend" ||
      item?.imageEndpoint ||
      item?.image_endpoint ||
      item?.legendEndpoint ||
      item?.legend_endpoint ||
      item?.imageUrl ||
      item?.image_url ||
      item?.url,
  );
}

function LegendImage({ item, muted = false, compact = true }) {
  const endpoint = item?.imageEndpoint || item?.image_endpoint || item?.legendEndpoint || item?.legend_endpoint || "";
  const directUrl = item?.imageUrl || item?.image_url || item?.url || "";
  const [src, setSrc] = useState(directUrl);

  useEffect(() => {
    if (!endpoint) {
      setSrc(directUrl);
      return undefined;
    }
    let active = true;
    let objectUrl = "";
    setSrc("");
    mapLayerService.getAuthenticatedBlob(endpoint)
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        if (active) setSrc(objectUrl);
        else URL.revokeObjectURL(objectUrl);
      })
      .catch((error) => {
        console.warn("Impossible de charger la légende WMS publiée par le serveur.", error);
        if (active) setSrc("");
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [directUrl, endpoint]);

  if (src) {
    if (compact) {
      return (
        <span className={`inline-flex max-w-[140px] shrink-0 overflow-hidden rounded bg-white/95 p-1 shadow-sm ${muted ? "opacity-40" : "opacity-100"}`}>
          <img src={src} alt={item?.label || "Légende WMS"} className="max-h-16 max-w-[128px] object-contain" loading="lazy" />
        </span>
      );
    }

    return (
      <span className={`block w-full overflow-auto rounded-xl border border-white/15 bg-white p-2 shadow-inner ${muted ? "opacity-50" : "opacity-100"}`}>
        <img src={src} alt={item?.label || "Légende WMS"} className="block h-auto max-h-[260px] max-w-full object-contain" loading="lazy" />
      </span>
    );
  }

  return (
    <span className={`${compact ? "h-4 w-10" : "h-16 w-full"} shrink-0 overflow-hidden rounded-sm border border-white/30 bg-white/10 ${muted ? "opacity-40" : "opacity-100"}`} />
  );
}

function LegendSymbol({ item, muted = false, compact = true }) {
  const opacityClass = muted ? "opacity-40" : "opacity-100";
  const strokeColor = item?.strokeColor || item?.color || "#123B5D";
  const fillColor = item?.fillColorRgba || item?.fillColor || item?.color || "rgba(199,178,153,0.35)";
  const strokeOpacity = clampNumber(item?.strokeOpacity ?? item?.opacity, 1, 0, 1);
  const fillOpacity = clampNumber(item?.fillOpacity, 1, 0, 1);
  const weight = clampNumber(item?.weight, 3, 1, 12);

  if (isLegendImageItem(item)) {
    return <LegendImage item={item} muted={muted} compact={compact} />;
  }

  if (item?.symbol === "line" || item?.symbol === "line-dashed") {
    return (
      <span
        className={`h-0 w-12 shrink-0 rounded-full ${opacityClass}`}
        style={{
          borderTopColor: colorWithOpacity(strokeColor, strokeOpacity),
          borderTopStyle: item?.symbol === "line-dashed" ? "dashed" : "solid",
          borderTopWidth: `${Math.max(2, Math.min(8, weight))}px`,
        }}
      />
    );
  }

  if (item?.symbol === "point") {
    const radius = clampNumber(item?.radius, 7, 2, 30);
    const size = Math.min(28, Math.max(10, radius * 2));
    return (
      <span
        className={`shrink-0 rounded-full shadow-[0_0_0_2px_rgba(255,255,255,0.14)] ${opacityClass}`}
        style={{
          width: `${size}px`,
          height: `${size}px`,
          border: `${Math.max(1, Math.min(5, weight))}px solid ${colorWithOpacity(strokeColor, strokeOpacity)}`,
          backgroundColor: colorWithOpacity(fillColor, fillOpacity),
        }}
      />
    );
  }

  if (item?.symbol === "polygon-outline") {
    return (
      <span
        className={`h-4 w-10 shrink-0 rounded-sm border-dashed ${opacityClass}`}
        style={{
          border: `${Math.max(1, Math.min(4, weight))}px dashed ${colorWithOpacity(strokeColor, strokeOpacity)}`,
          backgroundColor: fillColor ? colorWithOpacity(fillColor, fillOpacity) : "transparent",
        }}
      />
    );
  }

  if (item?.symbol === "image" || item?.symbol === "tile") {
    return (
      <span
        className={`h-4 w-10 shrink-0 overflow-hidden rounded-sm border ${opacityClass}`}
        style={{ borderColor: colorWithOpacity(strokeColor, strokeOpacity) }}
      >
        <span className="block h-full w-full bg-gradient-to-br from-white/60 via-white/20 to-white/5" />
      </span>
    );
  }

  return (
    <span
      className={`h-4 w-10 shrink-0 rounded-sm ${opacityClass}`}
      style={{
        border: `${Math.max(1, Math.min(4, weight))}px solid ${colorWithOpacity(strokeColor, strokeOpacity)}`,
        backgroundColor: colorWithOpacity(fillColor, fillOpacity),
      }}
    />
  );
}

function normaliseGeometryType(value) {
  const raw = String(value || "").toLowerCase();
  if (["line", "linestring", "multilinestring"].includes(raw)) return "line";
  if (["point", "multipoint"].includes(raw)) return "point";
  if (["polygon", "multipolygon"].includes(raw)) return "polygon";
  return raw;
}

function isReady(layer = {}) {
  return !layer.processing_status || layer.processing_status === "ready";
}

function canToggleLayer(layer = {}) {
  return Boolean(layer?.id) && layer.available !== false && isReady(layer);
}

function isParcelsLegendLayer(layer = {}) {
  return layer?.id === "parcels-portfolio" || layer?.group === "parcelles";
}

function layerDisplayName(layer = {}) {
  return layer?.id === "parcels-portfolio" || layer?.group === "parcelles" ? "Parcelles" : layer?.name || "Couche";
}

function layerStatus(layer = {}) {
  const visible = layer?.visible !== false;
  if (layer?.available === false || !isReady(layer)) {
    return { tone: "disabled", label: layer.displayMessage || layer.display_message || "Couche non prête ou non compatible" };
  }
  if (!visible) return { tone: "muted", label: "Masquée sur cette carte — cliquez pour réactiver" };
  if (layer?.error) return { tone: "error", label: layer.error };
  if (layer?.loading) return { tone: "loading", label: "Préparation…" };
  if (layer?.zoomVisible === false) return { tone: "warning", label: "Active, mais hors niveau de zoom" };
  if (Number.isFinite(Number(layer?.featureCount))) return { tone: "ok", label: `${Number(layer.featureCount).toLocaleString("fr-FR")} objet${Number(layer.featureCount) > 1 ? "s" : ""} chargé${Number(layer.featureCount) > 1 ? "s" : ""}` };
  return { tone: "ok", label: "Active" };
}

function legendItems(layer, features = []) {
  if (isParcelsLegendLayer(layer)) {
    return getAvailableLegendItems(features);
  }

  if (layer?.id === "communes") {
    return [
      {
        label: "Limite communale passive",
        symbol: "polygon-outline",
        color: "#2f3a43",
        fillColor: "rgba(47,58,67,0.025)",
      },
    ];
  }

  const sourceKind = String(layer?.type || layer?.service || "").toLowerCase();
  const sourceFormat = String(layer?.dataFormat || layer?.data_format || layer?.metadata?.dataFormat || layer?.clientLayerType || "").toLowerCase();
  const isWmsLayer = ["wms", "secure-tile"].includes(sourceKind) || sourceFormat === "wms";

  if (isWmsLayer) {
    const publishedLegend = (Array.isArray(layer?.legend) && layer.legend.length ? layer.legend : Array.isArray(layer?.metadata?.legend) ? layer.metadata.legend : [])
      .filter((item) => item?.imageEndpoint || item?.image_endpoint || item?.legendEndpoint || item?.legend_endpoint || item?.imageUrl || item?.image_url || item?.url);

    return publishedLegend.length
      ? publishedLegend
      : [{ label: layer?.name || "Légende WMS", symbol: "wms-legend", imageEndpoint: layer?.sourceLayerId ? `/map-layers/${layer.sourceLayerId}/legend/` : "" }];
  }

  if (Array.isArray(layer?.legend) && layer.legend.length) {
    return layer.legend.filter(Boolean);
  }

  if (Array.isArray(layer?.metadata?.legend) && layer.metadata.legend.length) {
    return layer.metadata.legend.filter(Boolean);
  }

  const geometryType = normaliseGeometryType(layer?.geometryType || layer?.geometry_type);
  const isTileLike = ["wms", "tile", "secure-tile"].includes(sourceKind);
  const style = layer?.style || layer?.metadata?.style || {};

  return [
    {
      label: layer?.name || "Élément cartographique",
      symbol: isTileLike ? "image" : geometryType === "line" ? "line" : geometryType === "point" ? "point" : "polygon",
      color: layer?.color || style.strokeColor || style.color || "#FBBF24",
      strokeColor: layer?.color || style.strokeColor || style.color || "#FBBF24",
      fillColor: layer?.fillColor || style.fillColor || style.fill || "#FBBF24",
      opacity: style.opacity,
      strokeOpacity: style.opacity,
      fillOpacity: style.fillOpacity,
      weight: style.weight,
      radius: style.radius,
    },
  ];
}

function LegendToggleRow({ layer, onToggleLayer, features = [] }) {
  const items = legendItems(layer, features);
  const visible = layer?.visible !== false;
  const unavailable = !canToggleLayer(layer);
  const layerLabel = layerDisplayName(layer);
  const status = layerStatus(layer);
  const isParcelsLayer = isParcelsLegendLayer(layer);
  const hasServerLegend = items.some(isLegendImageItem);
  const showInlineSymbol = !isParcelsLayer && !hasServerLegend && items.length > 0;
  const showItemDetails = visible && !unavailable && (
    isParcelsLayer
      ? items.length > 0
      : hasServerLegend || items.length > 1 || items.some((item) => item?.id && item?.symbol !== "wms-legend")
  );

  const handleToggle = (event) => {
    event.stopPropagation();

    if (unavailable) {
      return;
    }

    onToggleLayer?.(layer.id);
  };

  return (
    <div
      className={`rounded-xl border px-2 py-2 transition ${
        visible ? "border-white/10 bg-white/[0.055]" : "border-white/10 bg-white/[0.025]"
      } ${unavailable ? "opacity-65" : ""}`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={handleToggle}
            disabled={unavailable}
            className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg border transition focus:outline-none focus:ring-2 focus:ring-mapgeo-sand/30 disabled:cursor-not-allowed ${
              visible && !unavailable
                ? "border-mapgeo-sand/40 bg-mapgeo-primary/70 text-white shadow-soft"
                : "border-white/20 bg-white/[0.035] text-transparent hover:border-white/30 hover:bg-white/[0.065]"
            }`}
            aria-pressed={visible && !unavailable}
            aria-label={visible ? `Masquer ${layerLabel}` : `Afficher ${layerLabel}`}
            title={unavailable ? `${layerLabel} indisponible` : visible ? `Masquer ${layerLabel}` : `Afficher ${layerLabel}`}
          >
            {visible && !unavailable ? <Check size={20} strokeWidth={3} /> : null}
          </button>

          <span className="min-w-0">
            <span className={`block truncate text-[13px] font-extrabold ${visible && !unavailable ? "text-white" : "text-white/45"}`}>
              {layerLabel}
            </span>

            <span
              className={`mt-0.5 flex items-center gap-1.5 text-[11px] font-bold ${
                status.tone === "error"
                  ? "text-red-200"
                  : status.tone === "warning"
                    ? "text-mapgeo-sand/80"
                    : status.tone === "loading"
                      ? "text-white/70"
                      : status.tone === "ok"
                        ? "text-white/55"
                        : "text-white/42"
              }`}
            >
              {status.tone === "error" ? <AlertTriangle size={12} /> : null}
              {status.tone === "loading" ? <Loader2 size={12} className="animate-spin" /> : null}
              <span className="truncate">{status.label}</span>
            </span>
          </span>
        </span>

        {showInlineSymbol ? <LegendSymbol item={items[0]} muted={!visible || unavailable} /> : null}
      </div>

      {showItemDetails ? (
        <div className={`mt-2 space-y-2 border-t border-white/10 pt-2 ${isParcelsLayer ? "mapgeo-parcel-sublegend" : ""}`}>
          {items.map((item) => {
            const isImageLegend = isLegendImageItem(item);
            const itemKey = `${layer.id}-${item.id || item.label || item.url || item.imageUrl || item.imageEndpoint || "legend"}`;

            if (isImageLegend) {
              return (
                <div key={itemKey} className="rounded-xl border border-white/10 bg-black/10 p-2">
                  <div className="mb-1.5 truncate text-[12px] font-extrabold text-white/75">
                    {item.label || "Légende publiée par le serveur WMS"}
                  </div>
                  <LegendSymbol item={item} compact={false} />
                </div>
              );
            }

            return (
              <div
                key={itemKey}
                className="flex items-center justify-between gap-2 text-[11px] font-bold text-white/65"
              >
                <span className="truncate">{item.label}</span>
                <LegendSymbol item={item} />
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}) {
  const items = legendItems(layer, features);
  const visible = layer?.visible !== false;
  const unavailable = !canToggleLayer(layer);
  const layerLabel = layerDisplayName(layer);
  const status = layerStatus(layer);
  const isParcelsLayer = isParcelsLegendLayer(layer);
  const hasServerLegend = items.some(isLegendImageItem);
  const showInlineSymbol = !isParcelsLayer && !hasServerLegend && items.length > 0;
  const showItemDetails = visible && !unavailable && (
    isParcelsLayer
      ? items.length > 0
      : hasServerLegend || items.length > 1 || items.some((item) => item?.id && item?.symbol !== "wms-legend")
  );

  const handleToggle = (event) => {
    event.stopPropagation();

    if (unavailable) {
      return;
    }

    onToggleLayer?.(layer.id);
  };

  return (
    <div
      className={`rounded-xl border px-2 py-2 transition ${
        visible ? "border-white/10 bg-white/[0.055]" : "border-white/10 bg-white/[0.025]"
      } ${unavailable ? "opacity-65" : ""}`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={handleToggle}
            disabled={unavailable}
            className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg border transition focus:outline-none focus:ring-2 focus:ring-mapgeo-sand/30 disabled:cursor-not-allowed ${
              visible && !unavailable
                ? "border-mapgeo-sand/40 bg-mapgeo-primary/70 text-white shadow-soft"
                : "border-white/20 bg-white/[0.035] text-transparent hover:border-white/30 hover:bg-white/[0.065]"
            }`}
            aria-pressed={visible && !unavailable}
            aria-label={visible ? `Masquer ${layerLabel}` : `Afficher ${layerLabel}`}
            title={unavailable ? `${layerLabel} indisponible` : visible ? `Masquer ${layerLabel}` : `Afficher ${layerLabel}`}
          >
            {visible && !unavailable ? <Check size={20} strokeWidth={3} /> : null}
          </button>

          <span className="min-w-0">
            <span className={`block truncate text-[13px] font-extrabold ${visible && !unavailable ? "text-white" : "text-white/45"}`}>
              {layerLabel}
            </span>

            <span
              className={`mt-0.5 flex items-center gap-1.5 text-[11px] font-bold ${
                status.tone === "error"
                  ? "text-red-200"
                  : status.tone === "warning"
                    ? "text-mapgeo-sand/80"
                    : status.tone === "loading"
                      ? "text-white/70"
                      : status.tone === "ok"
                        ? "text-white/55"
                        : "text-white/42"
              }`}
            >
              {status.tone === "error" ? <AlertTriangle size={12} /> : null}
              {status.tone === "loading" ? <Loader2 size={12} className="animate-spin" /> : null}
              <span className="truncate">{status.label}</span>
            </span>
          </span>
        </span>

        {showInlineSymbol ? <LegendSymbol item={items[0]} muted={!visible || unavailable} /> : null}
      </div>

      {showItemDetails ? (
        <div className={`mt-2 space-y-2 border-t border-white/10 pt-2 ${isParcelsLayer ? "mapgeo-parcel-sublegend" : ""}`}>
          {items.map((item) => {
            const isImageLegend = isLegendImageItem(item);
            const itemKey = `${layer.id}-${item.id || item.label || item.url || item.imageUrl || item.imageEndpoint || "legend"}`;

            if (isImageLegend) {
              return (
                <div key={itemKey} className="rounded-xl border border-white/10 bg-black/10 p-2">
                  <div className="mb-1.5 truncate text-[12px] font-extrabold text-white/75">
                    {item.label || "Légende publiée par le serveur WMS"}
                  </div>
                  <LegendSymbol item={item} compact={false} />
                </div>
              );
            }

            return (
              <div
                key={itemKey}
                className="flex items-center justify-between gap-2 text-[11px] font-bold text-white/65"
              >
                <span className="truncate">{item.label}</span>
                <LegendSymbol item={item} />
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}) {
  const items = legendItems(layer, features);
  const visible = layer?.visible !== false;
  const unavailable = !canToggleLayer(layer);
  const layerLabel = layerDisplayName(layer);
  const status = layerStatus(layer);
  const hasServerLegend = items.some(isLegendImageItem);
  const showInlineSymbol = !hasServerLegend;
  const showItemDetails = visible && !unavailable && (hasServerLegend || items.length > 1 || items.some((item) => item?.id && item?.symbol !== "wms-legend"));
  

  const handleToggle = (event) => {
    event.stopPropagation();

    if (unavailable) {
      return;
    }

    onToggleLayer?.(layer.id);
  };

  return (
    <div
      className={`rounded-xl border px-2 py-2 transition ${
        visible ? "border-white/10 bg-white/[0.055]" : "border-white/10 bg-white/[0.025]"
      } ${unavailable ? "opacity-65" : ""}`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={handleToggle}
            disabled={unavailable}
            className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg border transition focus:outline-none focus:ring-2 focus:ring-mapgeo-sand/30 disabled:cursor-not-allowed ${
              visible && !unavailable
                ? "border-mapgeo-sand/40 bg-mapgeo-primary/70 text-white shadow-soft"
                : "border-white/20 bg-white/[0.035] text-transparent hover:border-white/30 hover:bg-white/[0.065]"
            }`}
            aria-pressed={visible && !unavailable}
            aria-label={visible ? `Masquer ${layerLabel}` : `Afficher ${layerLabel}`}
            title={unavailable ? `${layerLabel} indisponible` : visible ? `Masquer ${layerLabel}` : `Afficher ${layerLabel}`}
          >
            {visible && !unavailable ? <Check size={20} strokeWidth={3} /> : null}
          </button>

          <span className="min-w-0">
            <span className={`block truncate text-[13px] font-extrabold ${visible && !unavailable ? "text-white" : "text-white/45"}`}>
              {layerLabel}
            </span>

            <span
              className={`mt-0.5 flex items-center gap-1.5 text-[11px] font-bold ${
                status.tone === "error"
                  ? "text-red-200"
                  : status.tone === "warning"
                    ? "text-mapgeo-sand/80"
                    : status.tone === "loading"
                      ? "text-white/70"
                      : status.tone === "ok"
                        ? "text-white/55"
                        : "text-white/42"
              }`}
            >
              {status.tone === "error" ? <AlertTriangle size={12} /> : null}
              {status.tone === "loading" ? <Loader2 size={12} className="animate-spin" /> : null}
              <span className="truncate">{status.label}</span>
            </span>
          </span>
        </span>

        {showInlineSymbol ? <LegendSymbol item={items[0]} muted={!visible || unavailable} /> : null}
      </div>

      {showItemDetails ? (
        <div className="mt-2 space-y-2 border-t border-white/10 pt-2">
          {items.map((item) => {
            const isImageLegend = isLegendImageItem(item);
            const itemKey = `${layer.id}-${item.label || item.url || item.imageUrl || item.imageEndpoint || "legend"}`;

            if (isImageLegend) {
              return (
                <div key={itemKey} className="rounded-xl border border-white/10 bg-black/10 p-2">
                  <div className="mb-1.5 truncate text-[12px] font-extrabold text-white/75">
                    {item.label || "Légende publiée par le serveur WMS"}
                  </div>
                  <LegendSymbol item={item} compact={false} />
                </div>
              );
            }

            return (
              <div
                key={itemKey}
                className="flex items-center justify-between gap-2 text-[11px] font-bold text-white/65"
              >
                <span className="truncate">{item.label}</span>
                <LegendSymbol item={item} />
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export default function LegendPanel({ open, features = [], activeLayers = [], onToggleLayer }) {
  const legendLayers = useMemo(
    () =>
      (Array.isArray(activeLayers) ? activeLayers : [])
        .filter((layer) => {
          if (!layer?.id) return false;
          const isCoreLayer = layer.id === "parcels-portfolio" || layer.group === "parcelles";
          const isOptionalContextLayer = layer.id === "communes";
          const sourceKind = String(layer.service || layer.type || "").toLowerCase();
          const sourceFormat = String(layer.dataFormat || layer.data_format || layer.metadata?.dataFormat || layer.clientLayerType || "").toLowerCase();
          const isSupportedOperationalLayer = ["geojson", "wfs", "wms"].includes(sourceKind) || ["geojson", "wfs", "wms"].includes(sourceFormat);

          // Une couche désactivée par l'utilisateur reste listée pour pouvoir être réactivée.
          // Une couche non raccordée/non disponible ne doit pas créer d'entrée fantôme dans la légende.
          if (layer.available === false && !isCoreLayer) return false;
          return isCoreLayer || isOptionalContextLayer || isSupportedOperationalLayer;
        })
        .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0)),
    [activeLayers],
  );

  const visibleCount = legendLayers.filter((layer) => layer.visible !== false && canToggleLayer(layer)).length;
  const hiddenLayers = legendLayers.filter((layer) => layer.visible === false && canToggleLayer(layer));
  const hiddenCount = hiddenLayers.length;
  const totalCount = legendLayers.length;

  const showHiddenLayers = () => {
    hiddenLayers.forEach((layer) => onToggleLayer?.(layer.id));
  };

  if (!open) {
    return null;
  }

  return (
    <div
      className="mapgeo-mobile-tool-panel mapgeo-legend-panel mapgeo-export-hidden mapgeo-overlay-panel pointer-events-auto absolute bottom-3 left-3 right-3 z-[945] max-h-[46%] overflow-hidden rounded-2xl border border-white/10 bg-[#07111b]/88 p-2.5 text-white shadow-[0_12px_36px_rgba(0,0,0,0.28)] backdrop-blur-xl sm:bottom-4 sm:left-auto sm:right-4 sm:w-[252px] sm:max-w-[calc(100%-2rem)] lg:bottom-[178px]"
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-extrabold tracking-tight text-white">Légende</h3>

        <span className="rounded-lg border border-white/10 bg-white/[0.045] px-2 py-0.5 text-[10px] font-extrabold text-white/70">
          {visibleCount}/{totalCount}
        </span>
      </div>

      {hiddenCount ? (
        <button
          type="button"
          onClick={showHiddenLayers}
          className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-mapgeo-sand/25 bg-mapgeo-sand/10 px-2.5 py-1.5 text-[11px] font-extrabold text-mapgeo-sand transition hover:bg-mapgeo-sand/15"
        >
          <RotateCcw size={14} /> Réafficher {hiddenCount} couche{hiddenCount > 1 ? "s" : ""} masquée{hiddenCount > 1 ? "s" : ""}
        </button>
      ) : null}

      <div className="mapgeo-legend-scroll mt-2 space-y-1 pr-1">
        {legendLayers.length ? (
          legendLayers.map((layer) => (
            <LegendToggleRow
              key={layer.id}
              layer={layer}
              features={features}
              onToggleLayer={onToggleLayer}
            />
          ))
        ) : (
          <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-3 text-sm font-semibold leading-6 text-white/60">
            Aucune couche n’est disponible pour cette carte.
          </div>
        )}
      </div>

      {totalCount ? (
        <p className="mt-2 border-t border-white/10 pt-1.5 text-[10px] font-medium leading-4 text-white/40">
          Couches visibles.
        </p>
      ) : null}
    </div>
  );
}
