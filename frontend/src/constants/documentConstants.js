export const DOCUMENT_TYPE_OPTIONS = [
  ["plan_pdf", "Plan PDF"],
  ["pv_bornage", "PV"],
  ["rapport_topo", "Rapport"],
  ["orthophoto", "Orthophoto"],
  ["photo_terrain", "Photo terrain"],
  ["image_annotee", "Image annotée"],
  ["dxf", "DXF"],
  ["dwg", "DWG"],
  ["kml", "KML"],
  ["csv", "CSV"],
  ["excel", "Excel"],
  ["invoice", "Facture"],
  ["quote", "Devis"],
  ["other", "Autre"],
];

export const DOCUMENT_STATUS_OPTIONS = [
  ["draft", "Brouillon"],
  ["validated", "Validé"],
  ["final", "Final"],
  ["archived", "Archivé"],
];

export const PUBLIC_DOCUMENT_STATUSES = ["validated", "final"];

export const MAX_DOCUMENT_SIZE_BYTES = 25 * 1024 * 1024;
export const MAX_DOCUMENT_SIZE_LABEL = "25 Mo";

export const ACCEPTED_DOCUMENT_EXTENSIONS = [
  ".pdf",
  ".jpg",
  ".jpeg",
  ".png",
  ".tif",
  ".tiff",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".csv",
  ".kml",
  ".kmz",
  ".dxf",
  ".dwg",
  ".zip",
  ".txt",
];

export const ACCEPTED_DOCUMENT_ACCEPT = ACCEPTED_DOCUMENT_EXTENSIONS.join(",");
export const ACCEPTED_DOCUMENT_FORMATS_LABEL = "PDF, JPG, PNG, TIF, DOC, DOCX, XLS, XLSX, CSV, KML, KMZ, DXF, DWG, ZIP, TXT";

const SUSPICIOUS_FILENAME_PATTERN = /(^|[/\\])\.\.?($|[/\\])|[/\\]|\0|[<>:"|?*]/;
const WINDOWS_RESERVED_NAMES = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  "com1",
  "com2",
  "com3",
  "com4",
  "com5",
  "com6",
  "com7",
  "com8",
  "com9",
  "lpt1",
  "lpt2",
  "lpt3",
  "lpt4",
  "lpt5",
  "lpt6",
  "lpt7",
  "lpt8",
  "lpt9",
]);

export function canDocumentBePublic(status) {
  return PUBLIC_DOCUMENT_STATUSES.includes(status);
}

export function isDocumentVisibleToClient(document = {}) {
  return Boolean(document.is_public_for_client && canDocumentBePublic(document.status));
}

export function getDocumentVisibilityLabel(document = {}) {
  if (isDocumentVisibleToClient(document)) return "Visible client";
  if (document.is_public_for_client) return "Publication en attente";
  return "Interne";
}

export function getDocumentVisibilityClasses(document = {}) {
  if (isDocumentVisibleToClient(document)) return "border-mapgeo-line bg-mapgeo-primary/6 text-mapgeo-primary";
  if (document.is_public_for_client) return "border-mapgeo-sand/40 bg-mapgeo-sand/15 text-mapgeo-primary";
  return "border-mapgeo-line bg-mapgeo-ivory text-mapgeo-secondary/80";
}

export function validateDocumentFile(file) {
  if (!file) return "Un fichier est obligatoire.";

  const fileName = String(file.name || "").trim();
  if (!fileName) return "Le nom du fichier est invalide.";

  if (SUSPICIOUS_FILENAME_PATTERN.test(fileName)) {
    return "Le nom du fichier contient des caractères non autorisés.";
  }

  const baseName = fileName.split(".")[0]?.toLowerCase();
  if (WINDOWS_RESERVED_NAMES.has(baseName)) {
    return "Le nom du fichier est réservé par le système.";
  }

  const extension = fileName.includes(".") ? `.${fileName.split(".").pop()}`.toLowerCase() : "";

  if (!ACCEPTED_DOCUMENT_EXTENSIONS.includes(extension)) {
    return `Format non autorisé. Formats acceptés : ${ACCEPTED_DOCUMENT_FORMATS_LABEL}.`;
  }

  if (!Number(file.size || 0)) {
    return "Le fichier est vide.";
  }

  if (Number(file.size || 0) > MAX_DOCUMENT_SIZE_BYTES) {
    return `Le fichier dépasse la limite de ${MAX_DOCUMENT_SIZE_LABEL}.`;
  }

  return "";
}
