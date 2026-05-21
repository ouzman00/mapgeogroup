import { useEffect, useState } from "react";

function readCartographyViewportState() {
  if (typeof window === "undefined") {
    return {
      isMobileMap: false,
      isTouchDevice: false,
    };
  }

  const isMobileMap =
    window.matchMedia?.("(max-width: 767px)")?.matches || window.innerWidth < 768;

  const isTouchDevice = Boolean(
    window.matchMedia?.("(pointer: coarse)")?.matches ||
      window.matchMedia?.("(hover: none)")?.matches ||
      window.navigator?.maxTouchPoints > 0,
  );

  return {
    isMobileMap,
    isTouchDevice,
  };
}

export default function useCartographyViewport() {
  const [viewportState, setViewportState] = useState(() => readCartographyViewportState());

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const mediaQueries = [
      window.matchMedia?.("(max-width: 767px)"),
      window.matchMedia?.("(pointer: coarse)"),
      window.matchMedia?.("(hover: none)"),
    ].filter(Boolean);

    const refresh = () => {
      setViewportState(readCartographyViewportState());
    };

    refresh();
    window.addEventListener("resize", refresh, { passive: true });
    window.addEventListener("orientationchange", refresh, { passive: true });

    mediaQueries.forEach((query) => {
      query.addEventListener?.("change", refresh);
    });

    return () => {
      window.removeEventListener("resize", refresh);
      window.removeEventListener("orientationchange", refresh);
      mediaQueries.forEach((query) => {
        query.removeEventListener?.("change", refresh);
      });
    };
  }, []);

  return {
    isMobile: viewportState.isMobileMap,
    isMobileMap: viewportState.isMobileMap,
    isTouchDevice: viewportState.isTouchDevice,
  };
}
