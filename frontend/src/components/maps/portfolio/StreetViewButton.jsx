import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Loader2, X } from "lucide-react";

const GOOGLE_MAPS_SCRIPT_ID = "mapgeo-google-maps-js";

function readRuntimeConfig() {
  return window.__MAPGEO_CONFIG__ || {};
}

function readBooleanFlag(value, fallback = true) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    return !["false", "0", "no", "off"].includes(value.trim().toLowerCase());
  }

  return fallback;
}

function readStreetViewFlag() {
  const runtimeValue = readRuntimeConfig().ENABLE_STREET_VIEW;

  if (runtimeValue !== undefined && runtimeValue !== null) {
    return readBooleanFlag(runtimeValue, true);
  }

  return readBooleanFlag(import.meta.env.VITE_ENABLE_STREET_VIEW, true);
}

function readGoogleMapsApiKey() {
  const runtimeValue = readRuntimeConfig().GOOGLE_MAPS_API_KEY;

  if (typeof runtimeValue === "string" && runtimeValue.trim()) {
    return runtimeValue.trim();
  }

  const envValue = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

  if (typeof envValue === "string" && envValue.trim()) {
    return envValue.trim();
  }

  return "";
}

function getMapCenter(map) {
  const center = map?.getCenter?.();

  if (!center) {
    return null;
  }

  const lat = Number(center.lat);
  const lng = Number(center.lng);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  return { lat, lng };
}

function loadGoogleMaps(apiKey) {
  if (window.google?.maps?.StreetViewPanorama && window.google?.maps?.StreetViewService) {
    return Promise.resolve(window.google.maps);
  }

  if (!apiKey) {
    return Promise.reject(new Error("Clé Google Maps manquante."));
  }

  if (window.__mapgeoGoogleMapsPromise) {
    return window.__mapgeoGoogleMapsPromise;
  }

  window.__mapgeoGoogleMapsPromise = new Promise((resolve, reject) => {
    let script = document.getElementById(GOOGLE_MAPS_SCRIPT_ID);

    const handleLoad = () => {
      script.dataset.loaded = "true";

      if (window.google?.maps?.StreetViewPanorama && window.google?.maps?.StreetViewService) {
        resolve(window.google.maps);
        return;
      }

      window.__mapgeoGoogleMapsPromise = null;
      reject(new Error("Google Maps API chargée, mais Street View indisponible."));
    };

    const handleError = () => {
      window.__mapgeoGoogleMapsPromise = null;
      reject(new Error("Impossible de charger Google Maps API. Vérifie la clé, le domaine autorisé et Maps JavaScript API."));
    };

    if (!script) {
      script = document.createElement("script");
      script.id = GOOGLE_MAPS_SCRIPT_ID;
      script.async = true;
      script.defer = true;
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly`;
      script.addEventListener("load", handleLoad, { once: true });
      script.addEventListener("error", handleError, { once: true });
      document.head.appendChild(script);
      return;
    }

    if (script.dataset.loaded === "true" && window.google?.maps) {
      resolve(window.google.maps);
      return;
    }

    script.addEventListener("load", handleLoad, { once: true });
    script.addEventListener("error", handleError, { once: true });
  });

  return window.__mapgeoGoogleMapsPromise;
}

function PegmanIcon() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      className="h-5 w-5"
    >
      <circle cx="12" cy="5" r="2.35" fill="currentColor" />
      <path
        d="M9.1 8.55h5.8c.72 0 1.3.58 1.3 1.3v4.8c0 .5-.4.9-.9.9-.34 0-.65-.2-.8-.5l-.9-1.8v6.15c0 .6-.49 1.09-1.09 1.09h-1.02c-.6 0-1.09-.49-1.09-1.09v-6.15l-.9 1.8c-.15.3-.46.5-.8.5-.5 0-.9-.4-.9-.9v-4.8c0-.72.58-1.3 1.3-1.3Z"
        fill="currentColor"
      />
      <path
        d="M8.05 10.05h7.9"
        stroke="rgba(255,255,255,0.65)"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
    </svg>
  );
}

function StreetViewPanel({ map, apiKey, onClose }) {
  const panoramaRef = useRef(null);
  const panoramaInstanceRef = useRef(null);
  const [status, setStatus] = useState("loading");
  const [message, setMessage] = useState("Chargement de Street View…");

  useEffect(() => {
    let cancelled = false;

    async function initStreetView() {
      const position = getMapCenter(map);

      if (!position) {
        setStatus("error");
        setMessage("Impossible de récupérer le centre de la carte.");
        return;
      }

      if (!apiKey) {
        setStatus("error");
        setMessage("Clé Google Maps absente. Ajoute VITE_GOOGLE_MAPS_API_KEY dans Vercel puis redéploie.");
        return;
      }

      try {
        setStatus("loading");
        setMessage("Chargement de Google Maps API…");

        const googleMaps = await loadGoogleMaps(apiKey);

        if (cancelled || !panoramaRef.current) {
          return;
        }

        setMessage("Recherche d'une vue Street View proche…");

        const service = new googleMaps.StreetViewService();

        service.getPanorama(
          {
            location: position,
            radius: 120,
            preference: googleMaps.StreetViewPreference.NEAREST,
            source: googleMaps.StreetViewSource.DEFAULT,
          },
          (data, streetViewStatus) => {
            if (cancelled || !panoramaRef.current) {
              return;
            }

            if (streetViewStatus !== googleMaps.StreetViewStatus.OK || !data?.location?.pano) {
              setStatus("empty");
              setMessage("Aucune vue Street View trouvée à proximité du centre de la carte. Déplace la carte vers une route puis réessaie.");
              return;
            }

            panoramaInstanceRef.current = new googleMaps.StreetViewPanorama(
              panoramaRef.current,
              {
                pano: data.location.pano,
                visible: true,
                addressControl: true,
                linksControl: true,
                panControl: true,
                zoomControl: true,
                fullscreenControl: true,
                enableCloseButton: false,
                motionTracking: false,
                motionTrackingControl: false,
              }
            );

            setStatus("ready");
            setMessage("");
          }
        );
      } catch (error) {
        if (!cancelled) {
          setStatus("error");
          setMessage(error?.message || "Impossible d'ouvrir Street View.");
        }
      }
    }

    initStreetView();

    return () => {
      cancelled = true;

      if (panoramaInstanceRef.current) {
        panoramaInstanceRef.current.setVisible(false);
        panoramaInstanceRef.current = null;
      }
    };
  }, [apiKey, map]);

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] bg-slate-950/55 backdrop-blur-[1px] md:bg-transparent md:backdrop-blur-0"
      onClick={onClose}
    >
      <div
        className="absolute inset-x-3 bottom-3 top-16 overflow-hidden rounded-2xl border border-slate-700 bg-slate-950 shadow-2xl md:bottom-auto md:left-auto md:right-6 md:top-24 md:h-[560px] md:w-[500px]"
        role="dialog"
        aria-modal="false"
        aria-label="Street View"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900 px-4 py-3 text-white">
          <div>
            <p className="text-sm font-semibold">Street View</p>
            <p className="text-xs text-slate-400">Vue la plus proche du centre de la carte</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-slate-300 transition hover:bg-slate-800 hover:text-white"
            title="Fermer Street View"
            aria-label="Fermer Street View"
          >
            <X size={18} />
          </button>
        </div>

        <div className="relative h-[calc(100%-57px)] w-full bg-slate-950">
          <div ref={panoramaRef} className="h-full min-h-[300px] w-full" />

          {status !== "ready" ? (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-950/95 px-6 text-center text-sm text-slate-200">
              <div className="max-w-sm">
                {status === "loading" ? (
                  <Loader2 className="mx-auto mb-3 h-6 w-6 animate-spin text-amber-300" />
                ) : (
                  <AlertTriangle className="mx-auto mb-3 h-6 w-6 text-amber-300" />
                )}
                <p className="font-medium">{message}</p>
                {status === "error" ? (
                  <p className="mt-2 text-xs text-slate-400">
                    Vérifie VITE_GOOGLE_MAPS_API_KEY, l’activation de Maps JavaScript API et les restrictions HTTP referrer.
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>,
    document.body
  );
}

export default function StreetViewButton({ map, disabled = false, className = "" }) {
  const enabled = useMemo(() => readStreetViewFlag(), []);
  const apiKey = useMemo(() => readGoogleMapsApiKey(), []);
  const [isOpen, setIsOpen] = useState(false);

  const openStreetView = useCallback((event) => {
    event.preventDefault();
    event.stopPropagation();

    if (disabled) {
      return;
    }

    setIsOpen(true);
  }, [disabled]);

  const closeStreetView = useCallback(() => {
    setIsOpen(false);
  }, []);

  if (!enabled) {
    return null;
  }

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={openStreetView}
        className={`${className} mapgeo-street-view-button text-amber-300 hover:text-amber-200`}
        title="Ouvrir Street View"
        aria-label="Ouvrir Street View"
      >
        <PegmanIcon />
      </button>

      {isOpen ? (
        <StreetViewPanel map={map} apiKey={apiKey} onClose={closeStreetView} />
      ) : null}
    </>
  );
}
