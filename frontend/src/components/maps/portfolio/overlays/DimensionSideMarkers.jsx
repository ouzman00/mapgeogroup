import { Marker } from "react-leaflet";
import { createSideLabelIcon } from "../mapUtils";

export default function DimensionSideMarkers({
  markers = [],
  keyPrefix = "dimension",
  pane,
}) {
  if (!Array.isArray(markers) || !markers.length) return null;

  return markers
    .filter((item) => item?.visible !== false)
    .map((item) => (
      <Marker
        key={`${keyPrefix}-${item.id}`}
        position={item.point}
        pane={pane}
        icon={createSideLabelIcon(item.label, item.tone, item.angle || 0)}
        interactive={false}
      />
    ));
}
