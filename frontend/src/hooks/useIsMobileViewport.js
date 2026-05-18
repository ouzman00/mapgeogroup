import { useEffect, useState } from "react";

const MOBILE_QUERY = "(max-width: 767px)";

function evaluateMatch() {
  if (typeof window === "undefined") return false;
  if (typeof window.matchMedia !== "function") return window.innerWidth < 768;
  return window.matchMedia(MOBILE_QUERY).matches;
}

export default function useIsMobileViewport() {
  const [isMobile, setIsMobile] = useState(evaluateMatch);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;

    const mediaQuery = window.matchMedia(MOBILE_QUERY);
    const handler = (event) => setIsMobile(event.matches);

    // Compatibilite ancien Safari
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", handler);
    } else if (typeof mediaQuery.addListener === "function") {
      mediaQuery.addListener(handler);
    }

    setIsMobile(mediaQuery.matches);

    return () => {
      if (typeof mediaQuery.removeEventListener === "function") {
        mediaQuery.removeEventListener("change", handler);
      } else if (typeof mediaQuery.removeListener === "function") {
        mediaQuery.removeListener(handler);
      }
    };
  }, []);

  return isMobile;
}
