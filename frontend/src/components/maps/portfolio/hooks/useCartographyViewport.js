import { useEffect, useState } from "react";

function isMobileCartographyViewportSafe() {
  if (typeof window === "undefined") return false;

  return (
    window.matchMedia?.("(max-width: 767px)")?.matches ||
    window.matchMedia?.("(pointer: coarse)")?.matches ||
    window.matchMedia?.("(hover: none)")?.matches ||
    window.innerWidth < 768
  );
}

export default function useCartographyViewport() {
  const [isMobile, setIsMobile] = useState(() => isMobileCartographyViewportSafe());

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const mediaQueries = [
      window.matchMedia?.("(max-width: 767px)"),
      window.matchMedia?.("(pointer: coarse)"),
      window.matchMedia?.("(hover: none)"),
    ].filter(Boolean);

    const refresh = () => {
      setIsMobile(isMobileCartographyViewportSafe());
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

  return { isMobile };
}
