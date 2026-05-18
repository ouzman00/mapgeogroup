import { useEffect } from "react";

/**
 * Raccourcis clavier pro pour la cartographie.
 *
 * Echap : sortir du mode actif (mesure, edition, dessin)
 * F : fit / cadrer sur la parcelle selectionnee
 * L : toggle legende
 * +/- : zoom in/out
 * 0 : reset vue (revenir au centre par defaut)
 */
export default function useCartoKeyboardShortcuts({
  map,
  activeFeature,
  showMeasurements,
  setShowMeasurements,
  showLegend,
  setShowLegend,
  onEscape,
  enabled = true,
}) {
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return undefined;

    const handler = (event) => {
      // Ignorer si on est dans un input/textarea/contenteditable
      const target = event.target;
      const tag = target?.tagName?.toLowerCase();
      if (
        tag === "input" ||
        tag === "textarea" ||
        tag === "select" ||
        target?.isContentEditable
      ) {
        return;
      }

      // Echap : sortir du mode mesure ou notifier le parent
      if (event.key === "Escape") {
        if (showMeasurements) {
          event.preventDefault();
          setShowMeasurements?.(false);
        } else if (onEscape) {
          event.preventDefault();
          onEscape();
        }
        return;
      }

      // F : fit sur la parcelle active
      if (event.key === "f" || event.key === "F") {
        if (map && activeFeature?.center) {
          event.preventDefault();
          try {
            if (activeFeature.bounds) {
              map.fitBounds(activeFeature.bounds, { padding: [40, 40], maxZoom: 19 });
            } else {
              map.setView(activeFeature.center, 18);
            }
          } catch {
            // map non pret
          }
        }
        return;
      }

      // L : toggle legende
      if (event.key === "l" || event.key === "L") {
        if (setShowLegend) {
          event.preventDefault();
          setShowLegend(!showLegend);
        }
        return;
      }

      // +/- : zoom
      if ((event.key === "+" || event.key === "=") && map) {
        event.preventDefault();
        map.zoomIn();
        return;
      }
      if (event.key === "-" && map) {
        event.preventDefault();
        map.zoomOut();
        return;
      }

      // 0 : reset vue
      if (event.key === "0" && map && activeFeature?.center) {
        event.preventDefault();
        map.setView(activeFeature.center, 16);
        return;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    map,
    activeFeature,
    showMeasurements,
    setShowMeasurements,
    showLegend,
    setShowLegend,
    onEscape,
    enabled,
  ]);
}
