import { PARCEL_STATUS_LABELS } from "../../constants/parcelConstants";

export const PARCEL_STATUS_STYLES = {
  planned: {
    color: "#123B5D",
    fillColor: "#D9CAB8",
    label: PARCEL_STATUS_LABELS.planned,
    legend: "Mission planifiée",
  },
  to_verify: {
    color: "#B45309",
    fillColor: "#FDE7C7",
    label: PARCEL_STATUS_LABELS.to_verify,
    legend: "Vérification à faire",
  },
  completed: {
    color: "#0F766E",
    fillColor: "#D8F3EE",
    label: PARCEL_STATUS_LABELS.completed,
    legend: "Terminée",
  },

  // Compatibilité avec les anciennes valeurs déjà présentes en base.
  surveying: {
    color: "#B45309",
    fillColor: "#FDE7C7",
    label: "Vérification",
    legend: "Ancien statut : levé en cours",
  },
  processing: {
    color: "#B45309",
    fillColor: "#FDE7C7",
    label: "Vérification",
    legend: "Ancien statut : traitement",
  },
  draft: {
    color: "#123B5D",
    fillColor: "#D9CAB8",
    label: "Mission planifiée",
    legend: "Ancien statut : plan en préparation",
  },
  ready: {
    color: "#0F766E",
    fillColor: "#D8F3EE",
    label: "Terminée",
    legend: "Ancien statut : dossier prêt",
  },
  disputed: {
    color: "#B45309",
    fillColor: "#FDE7C7",
    label: "Vérification",
    legend: "Ancien statut : litige",
  },
};

export const DEFAULT_PARCEL_STYLE = {
  color: "#123B5D",
  fillColor: "#C7B299",
  label: "Statut non défini",
  legend: "Autre statut",
};

/**
 * Poids harmonisés des contours.
 * Avant, certains états montaient à 3.3 / 4 px, ce qui donnait des contours très inégaux.
 */
const BASE_WEIGHT = 1.7;
const WARNING_WEIGHT = 1.9;
const HOVER_WEIGHT = 2.25;
const ACTIVE_WEIGHT = 2.8;
const EDITING_WEIGHT = 3;
const LOCKED_WEIGHT = 1.8;
const ERROR_WEIGHT = 2.7;


const PROFESSIONAL_LEGEND_ITEMS = [
  {
    id: "geometry-error",
    label: "Erreur géométrique",
    symbol: "polygon",
    color: "#DC2626",
    fillColor: "rgba(254,226,226,0.24)",
  },
  {
    id: "surface-warning",
    label: "Écart surface à vérifier",
    symbol: "line-dashed",
    color: "#D97706",
  },
  {
    id: "has-documents",
    label: "Documents disponibles",
    symbol: "point",
    color: "#123B5D",
    fillColor: "#F7F5F2",
  },
];

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function normalizeRiskLevel(value) {
  const text = normalizeText(Array.isArray(value) ? value.join(" ") : value);

  if (!text) {
    return {
      id: "none",
      label: "Aucun risque déclaré",
      severity: "none",
    };
  }

  if (
    ["fort", "eleve", "high", "critique", "majeur", "rouge"].some((keyword) =>
      text.includes(keyword),
    )
  ) {
    return {
      id: "high",
      label: String(value),
      severity: "high",
    };
  }

  if (
    ["moyen", "modere", "medium", "orange"].some((keyword) =>
      text.includes(keyword),
    )
  ) {
    return {
      id: "medium",
      label: String(value),
      severity: "medium",
    };
  }

  if (
    ["faible", "low", "mineur", "vert"].some((keyword) =>
      text.includes(keyword),
    )
  ) {
    return {
      id: "low",
      label: String(value),
      severity: "low",
    };
  }

  return {
    id: "declared",
    label: String(value),
    severity: "medium",
  };
}

export function getSurfaceGapInfo(parcel = {}) {
  const official = Number(
    parcel?.official_area || parcel?.declared_area || parcel?.area,
  );

  const computed = Number(
    parcel?.computed_area || parcel?.calculated_area || parcel?.geom_area,
  );

  const hasBothAreas =
    Number.isFinite(official) &&
    official > 0 &&
    Number.isFinite(computed) &&
    computed > 0;

  if (!hasBothAreas) {
    return {
      hasBothAreas: false,
      absolute: 0,
      percent: 0,
      severity: "none",
    };
  }

  const absolute = Math.abs(computed - official);
  const percent = (absolute / official) * 100;

  const severity =
    percent >= 5 || absolute >= 100
      ? "danger"
      : percent >= 2 || absolute >= 25
        ? "warning"
        : "ok";

  return {
    hasBothAreas,
    absolute,
    percent,
    severity,
    official,
    computed,
  };
}

export function getParcelStatusStyle(status) {
  return PARCEL_STATUS_STYLES[status] || DEFAULT_PARCEL_STYLE;
}

export function getParcelSymbology(parcelOrStatus, options = {}) {
  const parcel =
    typeof parcelOrStatus === "object" && parcelOrStatus !== null
      ? parcelOrStatus
      : { status: parcelOrStatus };

  const style = getParcelStatusStyle(parcel.status);

  const risk = normalizeRiskLevel(
    parcel.risk_level || parcel.risk || parcel.risks,
  );

  const surfaceGap = getSurfaceGapInfo(parcel);

  const hasDocuments =
    Boolean(options.hasDocuments) ||
    (Array.isArray(parcel.documents)
      ? parcel.documents.length > 0
      : Number(parcel.documents_count || parcel.document_count || 0) > 0);

  const lockedByOther = Boolean(
    parcel.locked_by || parcel.locked_by_name || parcel.edit_lock_owner,
  );

  const editing = Boolean(
    parcel.is_editing || parcel.editing || parcel.editing_by || options.editing,
  );

  const active = Boolean(options.active || options.selected);
  const hovered = Boolean(options.hovered);

  const geometryError = Boolean(
    options.geometryError ||
    parcel.geometry_error ||
    parcel.geometry_valid === false ||
    parcel.topology_status === "invalid",
  );

  let color = style.color || "#123B5D";
  let fillColor = style.fillColor || "#C7B299";
  let weight = BASE_WEIGHT;
  let fillOpacity = options.muted ? 0.008 : 0.018;
  let dashArray = null;

  /**
   * Statut à vérifier : léger pointillé, mais contour proche des autres.
   */
  if (
    ["to_verify", "surveying", "processing", "disputed"].includes(parcel.status)
  ) {
    dashArray = "7 5";
    weight = WARNING_WEIGHT;
  }

  /**
   * Risques et écarts de surface :
   * orange/ambre, pas rouge. Rouge réservé aux erreurs géométriques réelles.
   */
  if (risk.severity === "medium" || risk.severity === "high") {
    color = "#D97706";
    weight = Math.max(weight, WARNING_WEIGHT);
    dashArray = risk.severity === "high" ? "4 4" : "8 5";
  }

  if (surfaceGap.severity === "warning" || surfaceGap.severity === "danger") {
    color = "#D97706";
    weight = Math.max(weight, WARNING_WEIGHT);
    dashArray = surfaceGap.severity === "danger" ? "4 4" : "8 5";
  }

  if (hasDocuments) {
    fillOpacity = Math.max(fillOpacity, 0.032);
  }

  /**
   * Hover : visible mais léger.
   */
  if (hovered && !active && !editing && !lockedByOther && !geometryError) {
    color = "#2563EB";
    fillColor = "#DBEAFE";
    weight = HOVER_WEIGHT;
    fillOpacity = Math.max(fillOpacity, 0.065);
  }

  /**
   * Sélection : plus visible, mais sans gros contour disproportionné.
   */
  if (active && !editing && !geometryError) {
    color = "#123B5D";
    fillColor = "#C7B299";
    weight = ACTIVE_WEIGHT;
    fillOpacity = 0.105;
    dashArray = null;
  }

  /**
   * Édition : bleu, pointillé, contour contrôlé.
   */
  if (editing) {
    color = "#2563EB";
    fillColor = "#DBEAFE";
    weight = EDITING_WEIGHT;
    dashArray = "10 6";
    fillOpacity = 0.12;
  }

  if (lockedByOther && !editing && !geometryError) {
    color = "#475569";
    fillColor = "#E2E8F0";
    weight = LOCKED_WEIGHT;
    dashArray = "3 6";
    fillOpacity = 0.045;
  }

  /**
   * Erreur géométrique : seul cas où le rouge est utilisé.
   */
  if (geometryError) {
    color = "#DC2626";
    fillColor = "#FEE2E2";
    weight = ERROR_WEIGHT;
    dashArray = "6 4";
    fillOpacity = active ? 0.13 : 0.075;
  }

  return {
    ...style,
    color,
    fillColor,
    weight,
    fillOpacity,
    dashArray,
    opacity: options.muted ? 0.45 : 1,
    risk,
    surfaceGap,
    hasDocuments,
    lockedByOther,
    editing,
    active,
    hovered,
    geometryError,
  };
}

export function getParcelPathOptions(parcelOrStatus, options = {}) {
  const symbology = getParcelSymbology(parcelOrStatus, options);

  return {
    color: symbology.color,
    fillColor: symbology.fillColor,
    fillOpacity: symbology.fillOpacity,
    opacity: symbology.opacity,
    weight: symbology.weight,
    dashArray: symbology.dashArray,
    lineJoin: "round",
    lineCap: "round",
    className: [
      "mapgeo-parcel-path",
      symbology.active ? "is-active" : "",
      symbology.hovered ? "is-hovered" : "",
      symbology.editing ? "is-editing" : "",
      symbology.geometryError ? "has-geometry-error" : "",
    ].filter(Boolean).join(" "),
  };
}

export function getAvailableLegendItems(features = []) {
  const normalizedFeatures = Array.isArray(features)
    ? features.filter(Boolean)
    : [];

  if (!normalizedFeatures.length) {
    return [];
  }

  const hasGeometryError = normalizedFeatures.some((feature) =>
    Boolean(
      feature?.geometryWarning ||
      feature?.parcel?.geometry_error ||
      feature?.parcel?.geometry_valid === false,
    ),
  );

  const hasDocuments = normalizedFeatures.some(
    (feature) =>
      Array.isArray(feature?.documents) && feature.documents.length > 0,
  );

  const hasSurfaceWarning = normalizedFeatures.some((feature) => {
    const gap = getSurfaceGapInfo(feature?.parcel || {});
    return gap.severity === "warning" || gap.severity === "danger";
  });

  return PROFESSIONAL_LEGEND_ITEMS.filter((item) => {
    if (item.id === "geometry-error") return hasGeometryError;
    if (item.id === "has-documents") return hasDocuments;
    if (item.id === "surface-warning") return hasSurfaceWarning;
    return true;
  });
}
