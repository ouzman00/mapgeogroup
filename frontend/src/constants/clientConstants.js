export const PORTAL_ACCESS_LABELS = {
  active: "Accès actif",
  pending: "Invitation en attente",
  disabled: "Accès désactivé",
  no_account: "Aucun compte portail",
};

export const PORTAL_ACCESS_CLASS_NAMES = {
  active: "border-mapgeo-line bg-mapgeo-primary/6 text-mapgeo-primary",
  pending: "border-mapgeo-line bg-mapgeo-sand/15 text-mapgeo-primary",
  disabled: "border-red-100 bg-red-50 text-red-700",
  no_account: "border-mapgeo-line bg-mapgeo-ivory text-mapgeo-secondary/80",
};

function toClientObject(client) {
  return client && typeof client === "object" ? client : {};
}

export function normalizePortalAccessStatus(client = {}) {
  const safeClient = toClientObject(client);
  const rawStatus = String(safeClient.portal_access_status || safeClient.portal_status || "").toLowerCase();
  if (["active", "enabled"].includes(rawStatus) || safeClient.primary_user_is_active === true) return "active";
  if (["pending", "pending_activation", "invited", "invitation_sent"].includes(rawStatus)) return "pending";
  if (["disabled", "inactive", "deactivated"].includes(rawStatus) || safeClient.primary_user_is_active === false) return "disabled";
  return "no_account";
}

export function getPortalAccessLabel(client = {}) {
  return PORTAL_ACCESS_LABELS[normalizePortalAccessStatus(client)] || PORTAL_ACCESS_LABELS.no_account;
}

export function getPortalAccessClasses(client = {}) {
  return PORTAL_ACCESS_CLASS_NAMES[normalizePortalAccessStatus(client)] || PORTAL_ACCESS_CLASS_NAMES.no_account;
}

export function getPortalAccessActionLabel(client = {}) {
  const safeClient = toClientObject(client);
  const status = normalizePortalAccessStatus(safeClient);
  const hasPortalAccount = Boolean(safeClient.primary_user_id || safeClient.user_id || safeClient.client_user_id);
  if (!hasPortalAccount || status === "no_account") return "Créer un accès";
  if (status === "disabled") return "Réactiver accès";
  return "Réinitialiser accès";
}
