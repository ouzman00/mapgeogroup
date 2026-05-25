import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";

const GOOGLE_MAPS_SCRIPT_ID = "mapgeo-google-maps-js";

function readRuntimeConfig() {
  return window.__MAPGEO_CONFIG__ || {};
}

function readStreetViewFlag() {
  const runtimeValue = readRuntimeConfig().ENABLE_STREET_VIEW;

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
  if (window.google?.maps?.StreetViewPanorama) {
    return Promise.resolve(window.google.maps);
  }

  if (!apiKey) {
    return Promise.reject(new Error("Clé Google Maps API manquante."));
  }

  const existingScript = document.getElementById(GOOGLE_MAPS_SCRIPT_ID);

  if (existingScript?.dataset.loaded === "true" && window.google?.maps) {
    return Promise.resolve(window.google.maps);
  }

  if (window.__mapgeoGoogleMapsPromise) {
    return window.__mapgeoGoogleMapsPromise;
  }

  window.__mapgeoGoogleMapsPromise = new Promise((resolve, reject) => {
    const script = existingScript || document.createElement("script");

    const cleanup = () => {
      script.removeEventListener("load", handleLoad);
      script.removeEventListener("error", handleError);
    };

    const handleLoad = () => {
      script.dataset.loaded = "true";
      cleanup();
      if (window.google?.maps) {
        resolve(window.google.maps);
      } else {
        reject(new Error("Google Maps API chargée, mais objet google.maps indisponible."));
      }
    };

    const handleError = () => {
      cleanup();
      window.__mapgeoGoogleMapsPromise = null;
      reject(new Error("Impossible de charger Google Maps API."));
    };

    script.id = GOOGLE_MAPS_SCRIPT_ID;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly`;
    script.async = true;
    script.defer = true;
    script.addEventListener("load", handleLoad);
    script.addEventListener("error", handleError);

    if (!existingScript) {
      document.head.appendChild(script);
    }
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
  const apiKey = useMemo(() => readGoogleMapsApiKey(), []);
  const panoramaRef = useRef(null);
  const panoramaInstanceRef = useRef(null);
  const [isOpen, setIsOpen] = useState(false);
  const [status, setStatus] = useState("idle");
  const [message, setMessage] = useState("");

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
    setStatus("idle");
    setMessage("");
  }, []);

  useEffect(() => {
    if (!isOpen || !enabled) {
      return;
    }

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
        setMessage("Clé Google Maps manquante : ajoute VITE_GOOGLE_MAPS_API_KEY dans Vercel.");
        return;
      }

      try {
        setStatus("loading");
        setMessage("Chargement de Street View…");

        const googleMaps = await loadGoogleMaps(apiKey);

        if (cancelled || !panoramaRef.current) {
          return;
        }

        const service = new googleMaps.StreetViewService();

        service.getPanorama(
          {
            location: position,
            radius: 80,
            preference: googleMaps.StreetViewPreference.NEAREST,
            source: googleMaps.StreetViewSource.OUTDOOR,
          },
          (data, streetViewStatus) => {
            if (cancelled || !panoramaRef.current) {
              return;
            }

            if (streetViewStatus !== googleMaps.StreetViewStatus.OK || !data?.location?.pano) {
              setStatus("empty");
              setMessage("Aucune vue Street View trouvée à proximité du centre de la carte.");
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
    };
  }, [apiKey, enabled, isOpen, map]);

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
        title="Ouvrir Street View au centre de la carte"
        aria-label="Ouvrir Street View au centre de la carte"
      >
        <PegmanIcon />
      </button>

      {isOpen ? (
        <div
          className="fixed inset-x-4 bottom-4 top-20 z-[1200] overflow-hidden rounded-2xl border border-slate-700 bg-slate-950 shadow-2xl md:left-auto md:right-6 md:top-24 md:h-[520px] md:w-[460px]"
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
              onClick={closeStreetView}
              className="rounded-full p-2 text-slate-300 transition hover:bg-slate-800 hover:text-white"
              title="Fermer Street View"
              aria-label="Fermer Street View"
            >
              <X size={18} />
            </button>
          </div>

          <div className="relative h-[calc(100%-57px)] w-full bg-slate-950">
            <div ref={panoramaRef} className="h-full w-full" />

            {status !== "ready" ? (
              <div className="absolute inset-0 flex items-center justify-center bg-slate-950/90 px-6 text-center text-sm text-slate-200">
                <div>
                  <p className="font-medium">{message || "Préparation de Street View…"}</p>
                  {status === "error" ? (
                    <p className="mt-2 text-xs text-slate-400">
                      Vérifie la clé Google Maps et l’activation de Maps JavaScript API.
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
