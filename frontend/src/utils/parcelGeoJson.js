import { normalizeToMultiPolygon } from "./geometryIo";

const GEOMETRY_TYPES = new Set([
  "Point",
  "MultiPoint",
  "LineString",
  "MultiLineString",
  "Polygon",
  "MultiPolygon",
  "GeometryCollection",
]);

const RESERVED_PROPERTY_KEYS = new Set([
  "geometry",
  "geojson",
  "geojson_feature",
  "feature",
  "features",
]);

function cloneJson(value) {
  if (value == null) return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

function isGeoJsonGeometry(value) {
  return Boolean(value?.type && GEOMETRY_TYPES.has(value.type));
}

function isGeoJsonFeature(value) {
  return value?.type === "Feature";
}

function isGeoJsonFeatureCollection(value) {
  return value?.type === "FeatureCollection" && Array.isArray(value.features);
}

export function extractGeoJsonGeometry(value) {
  if (!value) return null;

  if (isGeoJsonFeature(value)) return extractGeoJsonGeometry(value.geometry);

  if (isGeoJsonFeatureCollection(value)) {
    const geometries = [];
    value.features.forEach((feature) => {
      const geometry = extractGeoJsonGeometry(feature);
      if (geometry) geometries.push(geometry);
    });

    if (!geometries.length) return null;
    if (geometries.length === 1) return geometries[0];

    return {
      type: "GeometryCollection",
      geometries,
    };
  }

  if (isGeoJsonGeometry(value)) return cloneJson(value);

  return null;
}

export function normalizeParcelGeometry(parcelOrGeometry) {
  const geometry = extractGeoJsonGeometry(parcelOrGeometry?.geojson)
    || extractGeoJsonGeometry(parcelOrGeometry?.geojson_feature)
    || extractGeoJsonGeometry(parcelOrGeometry?.feature)
    || extractGeoJsonGeometry(parcelOrGeometry?.geometry)
    || extractGeoJsonGeometry(parcelOrGeometry);

  return normalizeToMultiPolygon(geometry) || geometry || null;
}

function buildGeoJsonProperties(parcel = {}) {
  const properties = {};

  Object.entries(parcel || {}).forEach(([key, value]) => {
    if (RESERVED_PROPERTY_KEYS.has(key)) return;
    if (typeof value === "function") return;
    properties[key] = cloneJson(value);
  });

  return properties;
}

export function parcelToGeoJsonFeature(parcel = {}) {
  const geometry = normalizeParcelGeometry(parcel);
  const properties = buildGeoJsonProperties(parcel);
  const id = parcel.id ?? parcel.pk ?? properties.id ?? properties.reference ?? null;

  if (id != null) properties.id = properties.id ?? id;

  return {
    type: "Feature",
    id: id ?? undefined,
    properties,
    geometry,
  };
}

export function parcelsToGeoJsonFeatureCollection(parcels = []) {
  return {
    type: "FeatureCollection",
    features: (Array.isArray(parcels) ? parcels : [])
      .map((parcel) => parcelToGeoJsonFeature(parcel))
      .filter((feature) => feature.geometry),
  };
}

export function geoJsonFeatureToParcel(feature, fallback = {}) {
  if (!isGeoJsonFeature(feature)) return normalizeParcelFromGeoJson(feature || fallback);

  const properties = feature.properties && typeof feature.properties === "object" ? feature.properties : {};
  const id = feature.id ?? properties.id ?? fallback.id;
  const geometry = normalizeParcelGeometry(feature.geometry);

  return {
    ...fallback,
    ...cloneJson(properties),
    ...(id != null ? { id } : {}),
    geometry,
    geojson: {
      type: "Feature",
      ...(id != null ? { id } : {}),
      properties: cloneJson(properties),
      geometry,
    },
  };
}

export function normalizeParcelFromGeoJson(parcel) {
  if (!parcel) return parcel;

  if (isGeoJsonFeature(parcel)) return geoJsonFeatureToParcel(parcel);

  if (isGeoJsonFeatureCollection(parcel)) {
    const results = parcel.features.map((feature) => geoJsonFeatureToParcel(feature));
    return results[0] || null;
  }

  const geometry = normalizeParcelGeometry(parcel);
  const normalized = {
    ...parcel,
    geometry,
  };

  return {
    ...normalized,
    geojson: geometry ? parcelToGeoJsonFeature(normalized) : parcel.geojson || null,
  };
}

export function normalizeGeoJsonParcelListResponse(data, normalizeListResponse) {
  if (isGeoJsonFeatureCollection(data)) {
    const results = data.features.map((feature) => geoJsonFeatureToParcel(feature));
    return {
      count: Number(data.count ?? results.length),
      next: data.next ?? null,
      previous: data.previous ?? null,
      results,
      geojson: parcelsToGeoJsonFeatureCollection(results),
    };
  }

  const payload = normalizeListResponse(data);
  const results = (payload.results || []).map((parcel) => normalizeParcelFromGeoJson(parcel));

  return {
    ...payload,
    results,
    geojson: parcelsToGeoJsonFeatureCollection(results),
  };
}
