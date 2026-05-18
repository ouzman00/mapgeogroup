import { PARCEL_STATUS_LABELS } from "../../constants/parcelConstants";

export const PARCEL_STATUS_STYLES = {
  // Mission planifiee : bleu clair / royal
  planned: {
    color: "#2563EB",
    fillColor: "#2563EB",
    label: PARCEL_STATUS_LABELS.planned,
    legend: "Mission planifiée",
  },
  // Brouillon : indigo (proche du bleu, mais distinguable)
  draft: {
    color: "#4F46E5",
    fillColor: "#4F46E5",
    label: "Brouillon",
    legend: "Brouillon",
  },
  // Leve en cours : cyan (terrain actif)
  surveying: {
    color: "#0891B2",
    fillColor: "#0891B2",
    label: "Levé en cours",
    legend: "Levé en cours",
  },
  // Traitement : teal fonce (bureau, post-leve)
  processing: {
    color: "#0F766E",
    fillColor: "#0F766E",
    label: "Traitement",
    legend: "Traitement",
  },
  // Dossier pret : vert sombre (proche de la fin)
  ready: {
    color: "#15803D",
    fillColor: "#15803D",
    label: "Dossier prêt",
    legend: "Dossier prêt",
  },
  // Bornage realise : vert vif (termine)
  completed: {
    color: "#22C55E",
    fillColor: "#22C55E",
    label: PARCEL_STATUS_LABELS.completed,
    legend: "Bornage réalisé",
  },
  // A verifier : orange ambre
  to_verify: {
    color: "#D97706",
    fillColor: "#D97706",
    label: PARCEL_STATUS_LABELS.to_verify,
    legend: "À vérifier",
  },
  // Litige : rouge
  disputed: {
    color: "#DC2626",
    fillColor: "#DC2626",
    label: "Litige",
    legend: "Litige",
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
// Contours epais : le style cadastre repose sur les bordures, pas sur le remplissage.
const BASE_WEIGHT = 2.5;
const WARNING_WEIGHT = 2.8;
const HOVER_WEIGHT = 3.5;
const ACTIVE_WEIGHT = 5;
const EDITING_WEIGHT = 4.5;
const LOCKED_WEIGHT = 2.4;
const ERROR_WEIGHT = 4;


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
  // Style cadastre : remplissage quasi-transparent, contour porte la couleur statut.
  // Le fond de carte (satellite, plan) reste pleinement visible a l interieur de la parcelle.
  let fillOpacity = options.muted ? 0.02 : 0.05;
  let dashArray = null;

  // Les statuts to_verify/surveying/processing/disputed sont differencies
  // par la couleur amber/violet uniquement.
  // Les pointilles sont reserves aux alertes metier (risque eleve, ecart surface).
  // Pas de dashArray ici : contour plein = plus lisible, plus professionnel.

  /**
   * Risques et écarts de surface :
   * orange/ambre, pas rouge. Rouge réservé aux erreurs géométriques réelles.
   */
  // Risque metier : contour orange, pointilles discrets UNIQUEMENT pour risque eleve
  if (risk.severity === "medium") {
    color = "#D97706";
    weight = Math.max(weight, WARNING_WEIGHT);
    // Risque moyen : contour plein orange, pas de pointilles
  }
  if (risk.severity === "high") {
    color = "#DC2626";
    weight = Math.max(weight, WARNING_WEIGHT);
    dashArray = "6 3"; // Pointilles courts = alerte visuelle claire
  }

  // Ecart de surface : meme logique, orange discret
  if (surfaceGap.severity === "warning") {
    color = "#D97706";
    weight = Math.max(weight, WARNING_WEIGHT);
  }
  if (surfaceGap.severity === "danger") {
    color = "#DC2626";
    weight = Math.max(weight, WARNING_WEIGHT);
    dashArray = "6 3";
  }

  if (hasDocuments) {
    // Parcelle avec documents : leger fill pour marquer la presence sans masquer le fond.
    fillOpacity = Math.max(fillOpacity, 0.12);
  }

  /**
   * Hover : on epaissit le contour, le passage en bleu signale l interactivite.
   * Fill quasi-nul, le fond reste visible.
   */
  if (hovered && !active && !editing && !lockedByOther && !geometryError) {
    color = "#2563EB";
    weight = HOVER_WEIGHT;
    fillOpacity = Math.max(fillOpacity, 0.08);
  }

  /**
   * Selection :
   * - conserve la couleur statut/metier
   * - contour fortement epaissi
   * - fill discret pour garder le fond visible
   * - rendu type SIG/cadastre moderne
   */
  if (active && !editing && !geometryError) {
    // Conserve la couleur statut definie plus haut
    color = color || style.color || "#123B5D";

    // Contour fort pour bien identifier la parcelle active
    weight = ACTIVE_WEIGHT;

    // Fill leger : on garde le satellite/plan visible
    fillOpacity = Math.max(fillOpacity, 0.16);

    // opacity geree par Leaflet via le style final
    dashArray = null;
  }

  /**
   * Édition : bleu, pointillé, contour contrôlé.
   */
  if (editing) {
    // Edition : contour bleu pointille bien visible, fill leger pour reperer la parcelle.
    color = "#2563EB";
    fillColor = "#DBEAFE";
    weight = EDITING_WEIGHT;
    dashArray = null;
    fillOpacity = 0.10;
  }

  if (lockedByOther && !editing && !geometryError) {
    color = "#475569";
    fillColor = "#E2E8F0";
    weight = LOCKED_WEIGHT;
    dashArray = null;
    fillOpacity = 0.04;
  }

  /**
   * Erreur géométrique : seul cas où le rouge est utilisé.
   */
  if (geometryError) {
    // Erreur : contour rouge gras, fill leger pour ne pas masquer la geometrie.
    color = "#DC2626";
    fillColor = "#FEE2E2";
    weight = ERROR_WEIGHT;
    dashArray = null;
    fillOpacity = active ? 0.16 : 0.08;
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

// Ordre logique d affichage des statuts dans la legende
const STATUS_LEGEND_ORDER = [
  "planned",
  "draft",
  "surveying",
  "processing",
  "ready",
  "completed",
  "to_verify",
  "disputed",
];

export function getAvailableLegendItems(features = []) {
  const normalizedFeatures = Array.isArray(features)
    ? features.filter(Boolean)
    : [];

  if (!normalizedFeatures.length) {
    return [];
  }

  // 1. Lister les statuts presents dans le portefeuille pour les afficher en haut
  const presentStatuses = new Set();
  for (const feature of normalizedFeatures) {
    const rawStatus = feature?.parcel?.status;
    if (rawStatus && PARCEL_STATUS_STYLES[rawStatus]) {
      presentStatuses.add(rawStatus);
    }
  }

  const statusItems = STATUS_LEGEND_ORDER
    .filter((status) => presentStatuses.has(status))
    .map((status) => {
      const style = PARCEL_STATUS_STYLES[status];
      return {
        id: `status-${status}`,
        label: style.legend || style.label || status,
        symbol: "polygon",
        color: style.color,
        fillColor: style.fillColor,
        fillOpacity: 0.2,
        strokeOpacity: 1,
        weight: 3,
      };
    });

  // 2. Items contextuels (alertes metier)
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

  const contextItems = PROFESSIONAL_LEGEND_ITEMS.filter((item) => {
    if (item.id === "geometry-error") return hasGeometryError;
    if (item.id === "has-documents") return hasDocuments;
    if (item.id === "surface-warning") return hasSurfaceWarning;
    return true;
  });

  return [...statusItems, ...contextItems];
}
