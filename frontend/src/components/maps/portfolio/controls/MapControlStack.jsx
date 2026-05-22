import { memo } from "react";
import { LocateFixed, Minus, Plus } from "lucide-react";
import { overlayEventProps } from "../utils/mapUiEvents";
import { USER_LOCATION_FOCUS_ZOOM } from "../../../../constants/mapConstants";

function MapControlStack({ map, locationEnabled, onToggleLocation, onLocationError }) {
  const disabled = !map;
  const buttonClass = "mapgeo-action-button grid h-11 w-11 place-items-center border-b border-white/10 text-white/80 last:border-b-0 hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-35";
  const locationButtonClass = `${buttonClass} ${locationEnabled ? "bg-mapgeo-primary/90 text-white shadow-[inset_0_0_0_1px_rgba(199,178,153,0.45)]" : ""}`;

  const locateUser = () => {
    if (!map) return;

    if (locationEnabled) {
      onToggleLocation?.(false);
      return;
    }

    if (typeof navigator === "undefined" || !navigator.geolocation || !map.locate) {
      onLocationError?.("Localisation indisponible");
      return;
    }

    const handleFound = (event) => {
      onLocationError?.("");
      map.flyTo(event.latlng, Math.max(map.getZoom(), USER_LOCATION_FOCUS_ZOOM), {
        animate: true,
        duration: 0.35,
      });
      onToggleLocation?.(true);
    };

    const handleError = () => {
      onToggleLocation?.(false);
      onLocationError?.("Localisation indisponible");
    };

    map.once("locationfound", handleFound);
    map.once("locationerror", handleError);
    map.locate({
      watch: false,
      setView: false,
      enableHighAccuracy: true,
      timeout: 8000,
      maximumAge: 1500,
    });
  };

  return (
    <div {...overlayEventProps} className="mapgeo-map-control-stack mapgeo-export-hidden mapgeo-popover-enter absolute right-3 top-[112px] z-[920] overflow-hidden rounded-2xl border border-white/10 bg-[#07111b]/80 shadow-[0_20px_60px_rgba(0,0,0,0.34)] backdrop-blur-xl sm:left-5 sm:right-auto sm:top-1/2 sm:-translate-y-1/2">
      <button type="button" disabled={disabled} onClick={() => map?.zoomIn(1, { animate: true })} className={`${buttonClass} mapgeo-zoom-button`} title="Zoom avant" aria-label="Zoom avant"><Plus size={20} /></button>
      <button type="button" disabled={disabled} onClick={() => map?.zoomOut(1, { animate: true })} className={`${buttonClass} mapgeo-zoom-button`} title="Zoom arrière" aria-label="Zoom arrière"><Minus size={20} /></button>
      <button type="button" disabled={disabled} onClick={locateUser} className={`${locationButtonClass} mapgeo-location-button`} title={locationEnabled ? "Désactiver la localisation" : "Me localiser"} aria-label={locationEnabled ? "Désactiver la localisation" : "Me localiser"}><LocateFixed size={19} /></button>
    </div>
  );
}

export default memo(MapControlStack);
