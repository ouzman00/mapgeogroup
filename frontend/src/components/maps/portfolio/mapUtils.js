import L from "leaflet";
import { escapeHtml } from "../../../config/mapConfig";

export const LABEL_MIN_ZOOM = 16;
export const DETAIL_MIN_ZOOM = 18;

export function clampOpacity(value, fallback = 1) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return fallback;
  return Math.min(1, Math.max(0, numericValue));
}

export function formatCoordinate(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return "—";
  return numericValue.toFixed(6);
}

export function formatProjectedCoordinate(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return "—";
  return numericValue.toLocaleString("fr-FR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

export function parseCoordinateQuery(value) {
  const matches = String(value || "").match(/-?\d+(?:[.,]\d+)?/g) || [];
  if (matches.length < 2) return null;

  const first = Number(matches[0].replace(",", "."));
  const second = Number(matches[1].replace(",", "."));
  if (!Number.isFinite(first) || !Number.isFinite(second)) return null;

  const candidates = [{ lat: first, lng: second }, { lat: second, lng: first }];
  return candidates.find((candidate) => Math.abs(candidate.lat) <= 90 && Math.abs(candidate.lng) <= 180) || null;
}

export function midpoint(a, b) {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

// Calcule l angle CSS d un segment pour placer un label parallele.
// On retourne toujours un angle entre -90 et +90 pour garder le texte lisible
// (jamais tete en bas).
export function segmentAngleCss(pointA, pointB) {
  if (!Array.isArray(pointA) || !Array.isArray(pointB)) return 0;
  // Leaflet [lat, lng] : Y = -lat (l ecran a Y inverse), X = lng
  const dx = (pointB[1] || 0) - (pointA[1] || 0);
  const dy = -((pointB[0] || 0) - (pointA[0] || 0));
  if (dx === 0 && dy === 0) return 0;
  let angle = Math.atan2(dy, dx) * (180 / Math.PI);
  // Garder le texte toujours lisible : si angle > 90 ou < -90, on flippe
  if (angle > 90) angle -= 180;
  else if (angle < -90) angle += 180;
  return angle;
}

export function createSideLabelIcon(label, tone = "default", angle = 0) {
  const toneClass = tone === "edit" ? "is-edit" : tone === "measure" ? "is-measure" : "";
  const safeAngle = Number.isFinite(angle) ? angle : 0;

  return L.divIcon({
    className: "mapgeo-side-label-shell",
    html: `<span class="mapgeo-side-label-rotor" style="transform: rotate(${safeAngle.toFixed(1)}deg);"><span class="mapgeo-side-label ${toneClass}" title="Longueur du côté">${escapeHtml(label)}</span></span>`,
    iconSize: [96, 28],
    iconAnchor: [48, 14],
  });
}

export function createAreaLabelIcon(label, subtitle = "Surface", tone = "default") {
  const safeSubtitle = subtitle ? `<em>${escapeHtml(subtitle)}</em>` : "";
  return L.divIcon({
    className: "mapgeo-area-label-shell",
    html: `
      <span class="mapgeo-area-label ${tone === "edit" ? "is-edit" : tone === "measure" ? "is-measure" : ""}">
        <strong>${escapeHtml(label)}</strong>
        ${safeSubtitle}
      </span>
    `,
    iconSize: [150, 54],
    iconAnchor: [75, 27],
  });
}

export function createParcelBadgeIcon(reference, status, active = false) {
  return L.divIcon({
    className: "mapgeo-parcel-badge-shell",
    html: `
      <div class="mapgeo-parcel-badge ${active ? "is-active" : ""}">
        <strong>${escapeHtml(reference || "Parcelle")}</strong>
        <span>${escapeHtml(status || "Statut")}</span>
      </div>
    `,
    iconSize: [104, 30],
    iconAnchor: [52, 15],
  });
}
export function createVertexGlowIcon(label, tone = "measure") {
  return L.divIcon({
    className: "mapgeo-vertex-glow-shell",
    html: `
      <span class="mapgeo-vertex-glow ${tone === "edit" ? "is-edit" : "is-measure"}">
        <span class="mapgeo-vertex-glow-dot"></span>
        <span class="mapgeo-vertex-glow-label">${escapeHtml(label)}</span>
      </span>
    `,
    iconSize: [54, 24],
    iconAnchor: [9, 10],
  });
}
