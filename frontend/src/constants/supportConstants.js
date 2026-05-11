export const SUPPORT_STATUS_LABELS = {
  open: "Ouvert",
  in_progress: "En cours",
  pending: "En attente",
  resolved: "Résolu",
  closed: "Clôturé",
};

export const SUPPORT_RESOLVED_STATUSES = ["resolved", "closed"];

export const SUPPORT_PRIORITY_LABELS = {
  low: "Basse",
  medium: "Moyenne",
  high: "Haute",
  urgent: "Urgente",
};

export const SUPPORT_ATTACHMENT_MAX_SIZE_BYTES = 15 * 1024 * 1024;
export const SUPPORT_ATTACHMENT_MAX_SIZE_LABEL = "15 Mo";

export const SUPPORT_ATTACHMENT_ALLOWED_EXTENSIONS = [
  ".pdf",
  ".png",
  ".jpg",
  ".jpeg",
  ".csv",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".txt",
  ".zip",
];

export const SUPPORT_ATTACHMENT_ACCEPT = SUPPORT_ATTACHMENT_ALLOWED_EXTENSIONS.join(",");
export const SUPPORT_ATTACHMENT_FORMATS_LABEL = "PDF, PNG, JPG, CSV, DOC, DOCX, XLS, XLSX, TXT, ZIP";

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

export function getSupportStatusLabel(status) {
  return SUPPORT_STATUS_LABELS[status] || status || "Statut inconnu";
}

export function getSupportPriorityLabel(priority) {
  return SUPPORT_PRIORITY_LABELS[priority] || priority || "—";
}

export function isResolvedOrClosed(status) {
  return SUPPORT_RESOLVED_STATUSES.includes(status);
}

export function validateSupportAttachment(file) {
  if (!file) return "";

  const fileName = String(file.name || "").trim();
  if (!fileName) return "Le nom de la pièce jointe est invalide.";
  if (SUSPICIOUS_FILENAME_PATTERN.test(fileName)) {
    return "Le nom de la pièce jointe contient des caractères non autorisés.";
  }

  const baseName = fileName.split(".")[0]?.toLowerCase();
  if (WINDOWS_RESERVED_NAMES.has(baseName)) {
    return "Le nom de la pièce jointe est réservé par le système.";
  }

  const extension = fileName.includes(".") ? `.${fileName.split(".").pop()}`.toLowerCase() : "";
  if (!SUPPORT_ATTACHMENT_ALLOWED_EXTENSIONS.includes(extension)) {
    return `Format non autorisé. Formats acceptés : ${SUPPORT_ATTACHMENT_FORMATS_LABEL}.`;
  }

  if (!Number(file.size || 0)) return "La pièce jointe est vide.";

  if ((file.size || 0) > SUPPORT_ATTACHMENT_MAX_SIZE_BYTES) {
    return `La pièce jointe dépasse la limite de ${SUPPORT_ATTACHMENT_MAX_SIZE_LABEL}.`;
  }

  return "";
}
