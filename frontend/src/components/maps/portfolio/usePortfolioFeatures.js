import { useMemo } from "react";
import { getParcelStatusLabel, progressFromStatus } from "../../../constants/parcelConstants";
import {
  buildDocuments,
  buildTimeline,
  computePerimeterFromPoints,
  formatArea,
  formatDistance,
  geometryAreaM2Projected,
  geometryToLeafletPositions,
  geometryToRings,
  getGeometrySupportMessage,
  getParcelCenter,
  haversineDistance,
} from "../../../utils/parcelGeometry";
import { LABEL_MIN_ZOOM } from "./mapUtils";
import { normalizeParcelFromGeoJson, parcelToGeoJsonFeature } from "../../../utils/parcelGeoJson";

function featureMatchesSearch(feature, searchMode, value) {
  const parcel = feature.parcel;

  if (searchMode === "reference") {
    return [parcel.reference, parcel.title_number, parcel.parcel_number]
      .filter(Boolean)
      .some((field) => String(field).toLowerCase().includes(value));
  }

  if (searchMode === "client") {
    return [parcel.owner_client_code, parcel.owner_name]
      .filter(Boolean)
      .some((field) => String(field).toLowerCase().includes(value));
  }

  if (searchMode === "commune") {
    return [parcel.commune, parcel.location]
      .filter(Boolean)
      .some((field) => String(field).toLowerCase().includes(value));
  }

  return [parcel.reference, parcel.location, parcel.commune, parcel.owner_client_code, parcel.owner_name, parcel.title_number, parcel.parcel_number]
    .filter(Boolean)
    .some((field) => String(field).toLowerCase().includes(value));
}

function buildFeature(parcel, activeParcel) {
  const rawSource = activeParcel && String(activeParcel.id) === String(parcel.id) ? activeParcel : parcel;
  const source = normalizeParcelFromGeoJson(rawSource);
  const parcelGeoJson = parcelToGeoJsonFeature(source);
  const geometry = parcelGeoJson.geometry || source.geometry;
  const rings = geometryToRings(geometry);
  const positions = geometryToLeafletPositions(geometry);
  const officialAreaValue = Number(source.official_area || source.declared_area || source.area || 0) || null;
  const projectedAreaValue = geometryAreaM2Projected(geometry) || null;
  const computedAreaValue = projectedAreaValue || Number(source.computed_area || source.calculated_area || source.geom_area || source.area || 0) || null;
  const areaValue = officialAreaValue || computedAreaValue || null;
  const perimeterValue =
    Number(source.computed_perimeter || source.perimeter || 0) ||
    rings.reduce((total, ring) => total + (computePerimeterFromPoints(ring) || 0), 0) ||
    null;

  return {
    id: source.id,
    parcel: { ...source, geometry, geojson: parcelGeoJson },
    geojson: parcelGeoJson,
    rings,
    positions,
    center: getParcelCenter({ ...source, geometry }),
    statusLabel: getParcelStatusLabel(source.status),
    progress: source.progress ?? progressFromStatus(source.status),
    areaLabel: formatArea(areaValue),
    officialAreaLabel: formatArea(officialAreaValue),
    computedAreaLabel: formatArea(computedAreaValue),
    perimeterLabel: formatDistance(perimeterValue),
    officialAreaValue,
    computedAreaValue,
    projectedAreaValue,
    perimeterValue,
    documents: buildDocuments(source),
    timeline: buildTimeline(source),
    geometryWarning: getGeometrySupportMessage(geometry),
  };
}

export default function usePortfolioFeatures({ parcels, activeParcel, searchTerm, searchMode, viewMode, mapZoom, showLabels, showMeasurements, activeLayerEnabled }) {
  const features = useMemo(() => {
    return (Array.isArray(parcels) ? parcels : []).map((parcel) => buildFeature(parcel, activeParcel));
  }, [parcels, activeParcel]);

  const activeFeature = useMemo(() => {
    const activeId = activeParcel?.id;
    if (!activeId) return null;

    return (
      features.find((feature) => String(feature.id) === String(activeId)) ||
      null
    );
  }, [features, activeParcel?.id]);

  const filteredFeatures = useMemo(() => {
    const value = searchTerm.trim().toLowerCase();
    if (!value) return features;
    return features.filter((feature) => featureMatchesSearch(feature, searchMode, value));
  }, [features, searchTerm, searchMode]);

  const displayedFeatures = useMemo(() => {
    if (!searchTerm.trim()) return features;
    return filteredFeatures;
  }, [features, filteredFeatures, searchTerm]);

  const viewportFeatures = useMemo(() => {
    // Keep every visible parcel rendered when a parcel is selected.
    // The viewport can still zoom/focus on the active parcel, but the portfolio context
    // must remain available for admin/client navigation and visual comparison.
    return displayedFeatures.length ? displayedFeatures : features;
  }, [displayedFeatures, features]);

  const portfolioSpreadKm = useMemo(() => {
    const centers = features.map((feature) => feature.center).filter((center) => Array.isArray(center) && center.length === 2);
    let maxDistance = 0;
    for (let i = 0; i < centers.length; i += 1) {
      for (let j = i + 1; j < centers.length; j += 1) {
        maxDistance = Math.max(maxDistance, haversineDistance(centers[i], centers[j]));
      }
    }
    return Math.round(maxDistance / 1000);
  }, [features]);

  const geometryCoverage = useMemo(() => features.filter((feature) => feature.rings.length > 0).length, [features]);
  const portfolioDocuments = useMemo(() => features.reduce((total, feature) => total + feature.documents.length, 0), [features]);
  const communesCount = useMemo(() => new Set(features.map((feature) => feature.parcel.commune).filter(Boolean)).size, [features]);

  const legendFeatures = useMemo(
    () => features.map((feature) => ({ ...feature, active: String(feature.id) === String(activeFeature?.id) })),
    [features, activeFeature],
  );

  const labelsAreVisible = showLabels && activeLayerEnabled && (
    (viewMode === "selection" && Boolean(activeFeature?.id)) ||
    mapZoom >= LABEL_MIN_ZOOM
  );
  return {
    features,
    activeFeature,
    filteredFeatures,
    displayedFeatures,
    viewportFeatures,
    portfolioSpreadKm,
    geometryCoverage,
    portfolioDocuments,
    communesCount,
    legendFeatures,
    labelsAreVisible,
  };
}
