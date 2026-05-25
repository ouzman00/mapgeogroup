import { useMemo } from "react";

function readStreetViewFlag() {
  const runtimeValue = window.__MAPGEO_CONFIG__?.ENABLE_STREET_VIEW;

  if (typeof runtimeValue === "boolean") {
    return runtimeValue;
  }

  if (typeof runtimeValue === "string") {
    return runtimeValue.toLowerCase() !== "false";
  }

  const envValue = import.meta.env.VITE_ENABLE_STREET_VIEW;

  if (typeof envValue === "string") {
    return envValue.toLowerCase() !== "false";
  }

  return true;
}

function buildStreetViewUrl(map) {
  const center = map?.getCenter?.();

  if (!center) {
    return null;
  }

  const lat = Number(center.lat);
  const lng = Number(center.lng);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  const roundedLat = lat.toFixed(7);
  const roundedLng = lng.toFixed(7);

  return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${roundedLat},${roundedLng}`;
}

function PegmanIcon() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      className="h-5 w-5"
    >
      <circle cx="12" cy="5.2" r="2.45" fill="currentColor" />
      <path
        d="M9.35 8.8h5.3c.72 0 1.3.58 1.3 1.3v4.45c0 .48-.39.87-.87.87-.33 0-.63-.19-.78-.49l-.82-1.64v6.15c0 .58-.47 1.05-1.05 1.05h-.86c-.58 0-1.05-.47-1.05-1.05v-6.15l-.82 1.64c-.15.3-.45.49-.78.49-.48 0-.87-.39-.87-.87V10.1c0-.72.58-1.3 1.3-1.3Z"
        fill="currentColor"
      />
      <path
        d="M7.75 10.15h8.5"
        stroke="rgba(255,255,255,0.55)"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function StreetViewButton({ map, disabled = false, className = "" }) {
  const enabled = useMemo(() => readStreetViewFlag(), []);

  if (!enabled) {
    return null;
  }

  const openStreetView = (event) => {
    event.preventDefault();
    event.stopPropagation();

    if (disabled) {
      return;
    }

    const url = buildStreetViewUrl(map);

    if (!url) {
      return;
    }

    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={openStreetView}
      className={`${className} mapgeo-street-view-button text-amber-300 hover:text-amber-200`}
      title="Ouvrir Street View au centre de la carte"
      aria-label="Ouvrir Street View au centre de la carte"
    >
      <PegmanIcon />
    </button>
  );
}
