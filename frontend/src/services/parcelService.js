import api, { fetchAllPages, getDeduped } from "./api";
import { normalizeListResponse } from "./responseUtils";
import { normalizeGeoJsonParcelListResponse, normalizeParcelFromGeoJson } from "../utils/parcelGeoJson";

function cloneJson(value) {
  if (value == null) return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

function closeRing(ring) {
  if (!Array.isArray(ring) || ring.length < 3) return [];
  const points = ring
    .filter((point) => Array.isArray(point) && point.length >= 2)
    .map((point) => [Number(point[0]), Number(point[1])])
    .filter((point) => Number.isFinite(point[0]) && Number.isFinite(point[1]));
  if (points.length < 3) return [];
  const first = points[0];
  const last = points[points.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) points.push([...first]);
  return points;
}

function normalizePolygonCoordinates(coordinates) {
  const rings = Array.isArray(coordinates) ? coordinates.map(closeRing).filter((ring) => ring.length >= 4) : [];
  return rings.length ? rings : null;
}

function normalizeGeometryForApi(geometry) {
  if (!geometry || typeof geometry !== "object") return geometry;

  if (geometry.type === "Feature") return normalizeGeometryForApi(geometry.geometry);

  if (geometry.type === "FeatureCollection") {
    const geometries = (geometry.features || [])
      .map((feature) => normalizeGeometryForApi(feature?.geometry))
      .filter(Boolean);
    if (geometries.length === 1) return geometries[0];
    return geometries.length ? { type: "GeometryCollection", geometries } : null;
  }

  if (geometry.type === "Polygon") {
    const coordinates = normalizePolygonCoordinates(geometry.coordinates);
    return coordinates ? { type: "Polygon", coordinates } : null;
  }

  if (geometry.type === "MultiPolygon") {
    const polygons = (Array.isArray(geometry.coordinates) ? geometry.coordinates : [])
      .map(normalizePolygonCoordinates)
      .filter(Boolean);

    // Pour une seule parcelle, envoyer un Polygon simple.
    // C'est le format qui a déjà réussi avec PowerShell.
    if (polygons.length === 1) return { type: "Polygon", coordinates: polygons[0] };

    return polygons.length ? { type: "MultiPolygon", coordinates: polygons } : null;
  }

  if (geometry.type === "Point") return { type: "Point", coordinates: cloneJson(geometry.coordinates) };

  if (geometry.type === "MultiPoint" || geometry.type === "LineString" || geometry.type === "MultiLineString") {
    return { type: geometry.type, coordinates: cloneJson(geometry.coordinates) };
  }

  if (geometry.type === "GeometryCollection") {
    return {
      type: "GeometryCollection",
      geometries: (geometry.geometries || []).map(normalizeGeometryForApi).filter(Boolean),
    };
  }

  return cloneJson(geometry);
}

function buildGeometryPatchPayload(payload = {}) {
  if (!Object.prototype.hasOwnProperty.call(payload, "geometry")) return payload;

  const geometry = payload.geometry == null ? null : normalizeGeometryForApi(payload.geometry);
  if (payload.geometry != null && !geometry) return payload;

  const timestamp = payload.expected_geometry_updated_at || payload.geometry_updated_at || null;

  return {
    ...payload,
    geometry,
    expected_geometry_updated_at: timestamp,
    geometry_change_reason: payload.geometry_change_reason || "Correction cartographique depuis l’interface",
  };
}

const parcelService = {
  async getParcels(params = {}) {
    const response = await getDeduped("/parcels/", { params });
    return normalizeGeoJsonParcelListResponse(response.data, normalizeListResponse);
  },

  async getAllParcels(params = {}) {
    const data = await fetchAllPages("/parcels/", params);
    return normalizeGeoJsonParcelListResponse(data, normalizeListResponse);
  },

  async searchParcels(params = {}) {
    const response = await getDeduped("/parcels/", {
      params: { page_size: 50, ...params },
    });
    return normalizeGeoJsonParcelListResponse(response.data, normalizeListResponse);
  },

  async getParcelMap(params = {}, requestConfig = {}) {
    const response = await getDeduped("/parcels/map/", { ...requestConfig, params });
    return normalizeGeoJsonParcelListResponse(response.data, normalizeListResponse);
  },

  async getParcelById(id, options = {}) {
    if (!id) throw new Error("Identifiant de parcelle manquant.");

    const hasRequestOptions =
      Object.prototype.hasOwnProperty.call(options, "params") ||
      Object.prototype.hasOwnProperty.call(options, "signal");

    const params = hasRequestOptions ? options.params || {} : options;
    const signal = hasRequestOptions ? options.signal : undefined;

    const response = await getDeduped(`/parcels/${id}/`, { params, signal });
    return normalizeParcelFromGeoJson(response.data);
  },

  async getParcelProgress(id) {
    if (!id) throw new Error("Identifiant de parcelle manquant.");
    const response = await getDeduped(`/parcels/${id}/progress/`);
    return response.data;
  },

  async getOwners(params = {}) {
    const response = await getDeduped("/parcels/owners/", { params });
    return normalizeListResponse(response.data).results;
  },

  async searchFirstParcel(params = {}) {
    const response = await this.getParcels({ ...params, page_size: 1 });
    return response.results[0] || null;
  },

  async importCsv(file, defaultOwnerId, options = {}) {
    const formData = new FormData();
    formData.append("file", file);
    if (defaultOwnerId) formData.append("default_owner_id", defaultOwnerId);
    if (options.organization) {
      formData.append("organization", options.organization);
      formData.append("organization_id", options.organization);
    }
    if (options.dryRun) formData.append("dry_run", "true");
    const response = await api.post("/parcels/import-csv/", formData);
    return response.data;
  },

  async createImportJob(file, defaultOwnerId, options = {}) {
    const formData = new FormData();
    formData.append("file", file);
    if (defaultOwnerId) formData.append("default_owner", defaultOwnerId);
    if (options.organization) formData.append("organization", options.organization);
    // Transmet le mode souple au backend — "true" ou "false" (string FormData)
    if (options.skip_errors !== undefined) {
      formData.append("skip_errors", options.skip_errors ? "true" : "false");
    }
    const response = await api.post("/imports/", formData);
    const job = response.data;
    if (options.validateImmediately) return this.validateImportJob(job.id);
    return job;
  },

  async getImportJob(id) {
    const response = await api.get(`/imports/${id}/`);
    return response.data;
  },

  async validateImportJob(id) {
    const response = await api.post(`/imports/${id}/validate/`);
    return response.data;
  },

  async executeImportJob(id) {
    const response = await api.post(`/imports/${id}/execute/`);
    return response.data;
  },

  async createParcel(payload) {
    const response = await api.post("/parcels/", payload);
    return normalizeParcelFromGeoJson(response.data);
  },

  async updateParcel(id, payload) {
    if (!id) throw new Error("Identifiant de parcelle manquant.");

    let preparedPayload = payload;

    if (Object.prototype.hasOwnProperty.call(payload || {}, "geometry")) {
      preparedPayload = buildGeometryPatchPayload(payload);
    }

    const response = await api.patch(`/parcels/${id}/`, preparedPayload);
    return normalizeParcelFromGeoJson(response.data);
  },

  async deleteParcel(id) {
    if (!id) throw new Error("Identifiant de parcelle manquant.");
    const response = await api.delete(`/parcels/${id}/`);
    return response.data;
  },
};

export default parcelService;
