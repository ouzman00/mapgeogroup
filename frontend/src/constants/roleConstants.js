export const ROLE_LABELS = {
  admin: "Administrateur",
  manager: "Responsable",
  agent: "Agent",
  surveyor: "Géomètre",
  client: "Client",
};

export const ADMIN_MANAGER_ROLES = ["admin", "manager"];
export const CONSULTATION_ONLY_ROLES = ["agent", "surveyor", "client"];

export function getRoleLabel(role) {
  return ROLE_LABELS[role] || role || "—";
}

export function hasManagementRole(user) {
  return ADMIN_MANAGER_ROLES.includes(user?.role);
}

export function canManageBackoffice(user, isInternalPortal = false) {
  return Boolean(isInternalPortal && hasManagementRole(user));
}
