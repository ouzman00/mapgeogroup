import { useEffect } from "react";
import { useMap } from "react-leaflet";

export const MAP_PANES = {
  parcels: "mapgeo-parcel-pane",
  labels: "mapgeo-parcel-label-pane",
  edit: "mapgeo-edit-pane",
  measure: "mapgeo-measure-pane",
};

export default function MapPaneController() {
  const map = useMap();

  useEffect(() => {
    if (!map) return undefined;

    const panes = [
      [MAP_PANES.parcels, 650, "auto"],
      [MAP_PANES.labels, 680, "auto"],
      [MAP_PANES.edit, 690, "auto"],
      [MAP_PANES.measure, 710, "none"],
    ];

    panes.forEach(([name, zIndex, pointerEvents]) => {
      const pane = map.getPane(name) || map.createPane(name);
      pane.style.zIndex = String(zIndex);
      pane.style.pointerEvents = pointerEvents;
    });

    // Les poignées de sommets Geoman sont rendues dans le markerPane Leaflet natif.
    // Le pane d'édition MapGeo est au-dessus des polygones standards ; on remonte donc
    // markerPane au-dessus de l'édition pour garder les sommets drag-and-drop.
    const markerPane = map.getPane("markerPane");
    if (markerPane) {
      markerPane.style.zIndex = "760";
      markerPane.style.pointerEvents = "auto";
    }

    return undefined;
  }, [map]);

  return null;
}
