export const PARCEL_STATUS_LABELS = {
  planned: "Mission planifiée",
  surveying: "Levé en cours",
  processing: "Traitement",
  draft: "Brouillon",
  ready: "Dossier prêt",
  completed: "Bornage réalisé",
  disputed: "Litige",
  to_verify: "À vérifier",
};

export const LEGACY_PARCEL_STATUS_LABELS = {
  created: "Créée",
  in_progress: "En cours",
  verification: "À vérifier",
  blocked: "Bloquée",
  report_finalized: "Rapport finalisé",
};

export const PARCEL_STATUS_OPTIONS = Object.entries(PARCEL_STATUS_LABELS).map(
  ([value, label]) => ({ value, label }),
);

export const PARCEL_STATUS_PROGRESS = {
  planned: 15,
  draft: 20,
  disputed: 30,
  to_verify: 35,
  surveying: 45,
  processing: 70,
  ready: 100,
  completed: 100,
};

export const PARCEL_STATUS_CLASS_NAMES = {
  planned: "border-mapgeo-line bg-mapgeo-ivory text-mapgeo-secondary/80",
  draft: "border-mapgeo-line bg-mapgeo-ivory text-mapgeo-secondary/80",
  surveying: "border-mapgeo-sand/40 bg-mapgeo-sand/15 text-mapgeo-primary",
  processing: "border-mapgeo-sand/40 bg-mapgeo-sand/15 text-mapgeo-primary",
  ready: "border-mapgeo-line bg-mapgeo-primary/6 text-mapgeo-primary",
  completed: "border-mapgeo-line bg-mapgeo-primary/6 text-mapgeo-primary",
  disputed: "border-red-100 bg-red-50 text-red-700",
  to_verify: "border-amber-200 bg-amber-50 text-amber-800",
};

const LEGACY_STATUS_TARGETS = {
  created: "planned",
  in_progress: "surveying",
  verification: "to_verify",
  blocked: "disputed",
  report_finalized: "completed",
};

export function normalizeParcelStatus(status) {
  if (PARCEL_STATUS_LABELS[status]) return status;
  return LEGACY_STATUS_TARGETS[status] || "planned";
}

export function progressFromStatus(status) {
  return PARCEL_STATUS_PROGRESS[normalizeParcelStatus(status)] ?? PARCEL_STATUS_PROGRESS.planned;
}

export function getParcelStatusLabel(status) {
  const normalized = normalizeParcelStatus(status);
  return PARCEL_STATUS_LABELS[normalized] || LEGACY_PARCEL_STATUS_LABELS[status] || status || "Statut non défini";
}

export function getParcelStatusClasses(status) {
  return PARCEL_STATUS_CLASS_NAMES[normalizeParcelStatus(status)] || PARCEL_STATUS_CLASS_NAMES.planned;
}
