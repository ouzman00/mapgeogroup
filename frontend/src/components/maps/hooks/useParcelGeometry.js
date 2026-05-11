import { useMemo } from "react";
import {
  buildDocuments,
  buildLookupFields,
  buildTimeline,
  buildVertexRows,
  computePerimeterFromPoints,
  formatArea,
  formatDistance,
  geometryToLeafletPositions,
  geometryToRings,
  getGeometrySupportMessage,
  getParcelCenter,
} from "../../../utils/parcelGeometry";
import { getParcelStatusLabel } from "../../../constants/parcelConstants";

export default function useParcelGeometry(parcel) {
  return useMemo(() => {
    const rings = geometryToRings(parcel?.geometry);
    const leafletPositions = geometryToLeafletPositions(parcel?.geometry);
    const primaryRing = rings[0] || [];
    const allVertexRows = rings.flatMap((ring, ringIndex) =>
      buildVertexRows(ring, rings.length > 1 ? { ringLabel: `P${ringIndex + 1}` } : {}),
    );

    const areaValue = Number(parcel?.computed_area || parcel?.area || 0) || null;
    const fallbackPerimeter = rings.reduce(
      (total, ring) => total + (computePerimeterFromPoints(ring) || 0),
      0,
    );
    const perimeterValue = Number(parcel?.computed_perimeter || parcel?.perimeter || 0) || fallbackPerimeter || null;

    return {
      rings,
      leafletPositions,
      primaryRing,
      center: getParcelCenter(parcel),
      areaValue,
      perimeterValue,
      areaLabel: formatArea(areaValue),
      perimeterLabel: formatDistance(perimeterValue),
      vertexRows: allVertexRows,
      documents: buildDocuments(parcel),
      timeline: buildTimeline(parcel),
      lookupFields: buildLookupFields(parcel),
      statusLabel: getParcelStatusLabel(parcel?.status),
      geometryWarning: getGeometrySupportMessage(parcel?.geometry),
    };
  }, [parcel]);
}
