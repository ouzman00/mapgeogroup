import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  ChevronRight,
  KeyRound,
  Mail,
  Plus,
  RefreshCcw,
  Search,
  ShieldCheck,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import DashboardLayout from "../layouts/DashboardLayout";
import LoadingState from "../components/ui/LoadingState";
import useAuth from "../hooks/useAuth";
import userService from "../services/userService";
import { getClientLookup } from "../services/clientService";
import { getErrorMessage } from "../services/responseUtils";
import { ROLE_LABELS, getRoleLabel } from "../constants/roleConstants";

const ROLE_OPTIONS = ["admin", "manager", "agent", "surveyor", "client"];
const INTERNAL_ROLES = ["admin", "manager", "agent", "surveyor"];
const STATUS_OPTIONS = [
  { value: "", label: "Tous les statuts" },
  { value: "active", label: "Actifs" },
  { value: "inactive", label: "Inactifs" },
  { value: "pending", label: "Invitations en attente" },
];

const emptyInviteForm = {
  email: "",
  first_name: "",
  last_name: "",
  company_name: "",
  role: "client",
  organization: "",
};

function normalizeUser(item) {
  const role = item.role || item.profile?.role || "client";
  const isClient = role === "client" || item.portal === "Client" || item.portal_type === "client";
  const organizations = Array.isArray(item.organizations) ? item.organizations : [];
  const primaryOrganization = organizations.find((organization) => organization.is_primary) || organizations[0];
  const isActive = item.is_active !== false;
  const isVerified = item.is_verified !== false;
  const isInvitationPending = isClient && !isActive && !isVerified;

  return {
    ...item,
    id: item.id,
    name:
      item.name ||
      item.full_name ||
      item.display_name ||
      [item.first_name, item.last_name].filter(Boolean).join(" ") ||
      item.username ||
      item.email ||
      "Utilisateur",
    email: item.email || "—",
    role,
    roleLabel: ROLE_LABELS[role] || role,
    portal: isClient ? "Client" : "Interne",
    organizationName: primaryOrganization?.name || item.organization_name || item.company_name || "—",
    organizationCode: primaryOrganization?.code || item.organization_code || item.client_code || "",
    status: isActive ? "Actif" : isInvitationPending ? "Invitation en attente" : "Inactif",
    statusKey: isActive ? "active" : isInvitationPending ? "pending" : "inactive",
    lastLogin: item.last_login ? new Date(item.last_login).toLocaleDateString("fr-FR") : "Jamais",
    isActive,
    isVerified,
  };
}

function statusClasses(statusKey) {
  if (statusKey === "active") return "border-mapgeo-line bg-mapgeo-primary/6 text-mapgeo-primary";
  if (statusKey === "pending") return "border-mapgeo-sand/35 bg-mapgeo-sand/15 text-mapgeo-primary";
  return "border-mapgeo-line bg-mapgeo-ivory text-mapgeo-secondary/75";
}

function fieldValue(value) {
  return typeof value === "string" ? value.trim() : value;
}

function Metric({ icon: Icon, label, value }) {
  return (
    <div className="rounded-3xl border border-mapgeo-line bg-white p-5 shadow-soft">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-mapgeo-sand/15 text-mapgeo-primary">
          <Icon size={21} />
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-mapgeo-secondary/70">{label}</p>
          <p className="mt-1 text-2xl font-extrabold text-mapgeo-primary">{value}</p>
        </div>
      </div>
    </div>
  );
}

function ModalShell({ title, children, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-mapgeo-primary/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-3xl border border-mapgeo-line bg-white shadow-panel">
        <div className="flex items-center justify-between border-b border-mapgeo-line px-6 py-4">
          <h3 className="text-xl font-extrabold text-mapgeo-primary">{title}</h3>
          <button type="button" onClick={onClose} className="rounded-full p-2 text-mapgeo-secondary hover:bg-mapgeo-ivory" aria-label="Fermer">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Summary({ icon: Icon, label, value }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <Icon size={17} className="text-white/70" />
      <span className="flex-1 text-white/80">{label}</span>
      <span className="font-extrabold text-white">{value}</span>
    </div>
  );
}

export default function UsersSettingsPage() {
  const { user } = useAuth();
  const canManageInternalRoles = user?.role === "admin";
  const [apiUsers, setApiUsers] = useState([]);
  const [organizations, setOrganizations] = useState([]);
  const [query, setQuery] = useState("");
  const [role, setRole] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteForm, setInviteForm] = useState(emptyInviteForm);
  const [submittingInvite, setSubmittingInvite] = useState(false);
  const [pendingAction, setPendingAction] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);

  const availableInviteRoles = canManageInternalRoles ? ROLE_OPTIONS : ["client"];

  const loadUsers = async (params = {}) => {
    setLoading(true);
    setError("");
    try {
      const payload = await userService.getAllUsers(params);
      setApiUsers(payload.results || []);
    } catch (loadError) {
      setError(getErrorMessage(loadError, "Impossible de charger les utilisateurs."));
      setApiUsers([]);
    } finally {
      setLoading(false);
    }
  };

  const loadOrganizations = async () => {
    try {
      const payload = await getClientLookup({ limit: 200 });
      setOrganizations(payload.results || []);
    } catch {
      setOrganizations([]);
    }
  };

  useEffect(() => {
    loadUsers();
    loadOrganizations();
  }, []);

  const users = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return apiUsers.map(normalizeUser).filter((item) => {
      const matchesQuery = !normalizedQuery || [
        item.name,
        item.email,
        item.username,
        item.roleLabel,
        item.portal,
        item.organizationName,
        item.organizationCode,
        item.client_code,
      ].some((value) => String(value || "").toLowerCase().includes(normalizedQuery));
      const matchesRole = !role || item.role === role;
      const matchesStatus = !statusFilter || item.statusKey === statusFilter;
      return matchesQuery && matchesRole && matchesStatus;
    });
  }, [apiUsers, query, role, statusFilter]);

  const updateInviteForm = (field, value) => {
    setInviteForm((current) => ({
      ...current,
      [field]: value,
      ...(field === "role" && value !== "client" ? { organization: "" } : {}),
    }));
  };

  const openInviteModal = () => {
    setMessage("");
    setError("");
    setInviteForm({ ...emptyInviteForm, role: "client" });
    setInviteOpen(true);
  };

  const submitInvite = async (event) => {
    event.preventDefault();
    setMessage("");
    setError("");

    const email = fieldValue(inviteForm.email)?.toLowerCase();
    const selectedRole = canManageInternalRoles && ROLE_OPTIONS.includes(inviteForm.role) ? inviteForm.role : "client";

    if (!email) {
      setError("L’adresse e-mail est obligatoire.");
      return;
    }

    if (selectedRole === "client" && !inviteForm.organization) {
      setError("Sélectionnez l’organisation client à rattacher à cet utilisateur.");
      return;
    }

    const payload = {
      email,
      role: selectedRole,
      first_name: fieldValue(inviteForm.first_name) || "",
      last_name: fieldValue(inviteForm.last_name) || "",
      company_name: fieldValue(inviteForm.company_name) || "",
    };

    if (selectedRole === "client") {
      payload.organization = inviteForm.organization;
    }

    setSubmittingInvite(true);
    try {
      const result = await userService.inviteUser(payload);
      const suffix = result?.invitation_sent ? " Un e-mail sécurisé a été envoyé." : " Aucun e-mail n’a pu être envoyé.";
      setMessage(`Utilisateur invité : ${email}.${suffix}`);
      setInviteOpen(false);
      await loadUsers();
    } catch (inviteError) {
      setError(getErrorMessage(inviteError, "Invitation impossible."));
    } finally {
      setSubmittingInvite(false);
    }
  };

  const isInternalTarget = (targetUser) => INTERNAL_ROLES.includes(targetUser?.role);

  const changeRole = async (targetUser, nextRole) => {
    if (!canManageInternalRoles) {
      setError("Seul un administrateur peut modifier les rôles.");
      return;
    }
    if (!nextRole || nextRole === targetUser.role) return;

    setMessage("");
    setError("");
    try {
      await userService.updateUser(targetUser.id, { role: nextRole });
      setMessage(`${targetUser.name} passe au rôle ${ROLE_LABELS[nextRole] || nextRole}.`);
      await loadUsers();
    } catch (updateError) {
      setError(getErrorMessage(updateError, "Modification du rôle impossible."));
    }
  };

  const openUserAction = (type, targetUser) => {
    setMessage("");
    setError("");
    setPendingAction({ type, user: targetUser });
  };

  const runUserAction = async () => {
    if (!pendingAction?.user) return;

    const targetUser = pendingAction.user;
    setActionLoading(true);
    setMessage("");
    setError("");

    try {
      if (pendingAction.type === "reset") {
        const result = await userService.resetAccess(targetUser.id);
        const suffix = result?.reset_sent ? " Un lien sécurisé a été envoyé par e-mail." : " Aucun e-mail n’a pu être envoyé.";
        setMessage(`Accès réinitialisé pour ${targetUser.name}.${suffix}`);
      } else if (pendingAction.type === "activate") {
        await userService.activateUser(targetUser.id);
        setMessage(`${targetUser.name} a été activé.`);
      } else if (pendingAction.type === "deactivate") {
        await userService.deactivateUser(targetUser.id);
        setMessage(`${targetUser.name} a été désactivé.`);
      }
      setPendingAction(null);
      await loadUsers();
    } catch (actionError) {
      setError(getErrorMessage(actionError, "Action utilisateur impossible."));
    } finally {
      setActionLoading(false);
    }
  };

  const resetFilters = () => {
    setQuery("");
    setRole("");
    setStatusFilter("");
    setMessage("Filtres utilisateurs réinitialisés.");
  };

  const sidebarActions = [
    { label: "Inviter un utilisateur", action: openInviteModal },
    { label: "Voir les invitations", action: () => { setStatusFilter("pending"); setMessage("Filtre invitations en attente activé."); } },
    { label: canManageInternalRoles ? "Voir les administrateurs" : "Voir les clients", action: () => { setRole(canManageInternalRoles ? "admin" : "client"); setMessage("Filtre rôle activé."); } },
    { label: "Actualiser la liste", action: () => loadUsers() },
  ];

  const activeUsersCount = users.filter((item) => item.statusKey === "active").length;
  const pendingUsersCount = users.filter((item) => item.statusKey === "pending").length;

  const actionTitle = pendingAction?.type === "reset"
    ? "Réinitialiser l’accès"
    : pendingAction?.type === "activate"
      ? "Activer l’utilisateur"
      : "Désactiver l’utilisateur";
  const actionText = pendingAction?.type === "reset"
    ? "Un lien sécurisé de réinitialisation sera envoyé si une adresse e-mail est associée au compte."
    : pendingAction?.type === "activate"
      ? "Le compte pourra de nouveau accéder au portail selon son rôle."
      : "Le compte ne pourra plus se connecter tant qu’il n’est pas réactivé.";

  return (
    <DashboardLayout title="Utilisateurs & rôles" subtitle="Gérez les accès internes, les invitations client et les rôles du portail.">
      <div className="space-y-6">
        <section className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <nav className="text-sm font-semibold text-mapgeo-primary" aria-label="Fil d’Ariane">
              Accueil <span className="mx-1 text-mapgeo-secondary/40">/</span> Paramètres <span className="mx-1 text-mapgeo-secondary/40">/</span> Utilisateurs
            </nav>
            <h1 className="mt-3 text-3xl font-extrabold text-mapgeo-primary">Utilisateurs & rôles</h1>
            <p className="mt-2 text-sm text-mapgeo-secondary/70">Centralisez les accès, rôles et invitations des utilisateurs MAPGEO.</p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link to="/settings" className="inline-flex items-center justify-center gap-2 rounded-2xl border border-mapgeo-line bg-white px-5 py-3 text-sm font-bold text-mapgeo-primary shadow-soft hover:bg-mapgeo-ivory">
              <ArrowLeft size={18} /> Paramètres
            </Link>
            <button type="button" onClick={openInviteModal} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-mapgeo-primary px-5 py-3 text-sm font-extrabold text-white shadow-panel">
              <Plus size={18} /> {canManageInternalRoles ? "Inviter utilisateur" : "Inviter un client"}
            </button>
          </div>
        </section>

        {message ? <p className="rounded-2xl border border-mapgeo-line bg-mapgeo-primary/6 px-4 py-3 text-sm font-medium text-mapgeo-primary">{message}</p> : null}
        {error ? <p className="rounded-2xl border border-mapgeo-sand/40 bg-mapgeo-sand/10 px-4 py-3 text-sm font-medium text-mapgeo-primary">{error}</p> : null}

        <section className="grid grid-cols-1 gap-5 md:grid-cols-2 2xl:grid-cols-4">
          <Metric icon={UsersRound} label="Utilisateurs" value={users.length} />
          <Metric icon={ShieldCheck} label="Administrateurs" value={users.filter((item) => item.role === "admin").length} />
          <Metric icon={UserRound} label="Clients" value={users.filter((item) => item.portal === "Client").length} />
          <Metric icon={Mail} label="Invitations" value={pendingUsersCount} />
        </section>

        <section className="grid grid-cols-1 gap-6 2xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="space-y-6">
            <section className="rounded-3xl border border-mapgeo-line bg-white p-4 shadow-soft">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_190px_220px_auto]">
                <label className="flex h-11 items-center gap-2 rounded-2xl border border-mapgeo-line px-3">
                  <Search size={16} className="text-mapgeo-secondary/60" />
                  <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher nom, email, organisation..." className="min-w-0 flex-1 border-0 bg-transparent text-sm outline-none" />
                </label>
                <select value={role} onChange={(event) => setRole(event.target.value)} className="h-11 rounded-2xl border border-mapgeo-line bg-white px-3 text-sm outline-none">
                  <option value="">Tous les rôles</option>
                  {ROLE_OPTIONS.map((value) => <option key={value} value={value}>{getRoleLabel(value)}</option>)}
                </select>
                <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="h-11 rounded-2xl border border-mapgeo-line bg-white px-3 text-sm outline-none">
                  {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
                <button type="button" onClick={resetFilters} className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-mapgeo-line bg-white px-4 text-sm font-bold text-mapgeo-primary hover:bg-mapgeo-ivory">
                  <RefreshCcw size={16} /> Réinitialiser
                </button>
              </div>
            </section>

            <section className="rounded-3xl border border-mapgeo-line bg-white shadow-soft">
              <div className="border-b border-mapgeo-line p-5">
                <h2 className="text-xl font-extrabold text-mapgeo-primary">Liste des utilisateurs</h2>
              </div>
              {loading ? (
                <div className="p-5">
                  <LoadingState
                    title="Veuillez patienter"
                    message="Mise à jour des utilisateurs."
                    compact
                  />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-[1040px] w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-mapgeo-line bg-mapgeo-ivory/70 text-xs font-bold uppercase tracking-[0.10em] text-mapgeo-secondary/70">
                        <th className="px-5 py-4">Utilisateur</th>
                        <th className="px-5 py-4">Email</th>
                        <th className="px-5 py-4">Organisation</th>
                        <th className="px-5 py-4">Rôle</th>
                        <th className="px-5 py-4">Portail</th>
                        <th className="px-5 py-4">Statut</th>
                        <th className="px-5 py-4">Dernière connexion</th>
                        <th className="px-5 py-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-mapgeo-line">
                      {users.length ? users.map((item) => {
                        const resetDisabled = !canManageInternalRoles && isInternalTarget(item);
                        const deactivateDisabled = item.id === user?.id || (!canManageInternalRoles && isInternalTarget(item));
                        return (
                          <tr key={item.id} className="hover:bg-mapgeo-ivory/40">
                            <td className="px-5 py-4 font-extrabold text-mapgeo-primary">{item.name}</td>
                            <td className="px-5 py-4 text-mapgeo-secondary">{item.email}</td>
                            <td className="px-5 py-4 text-mapgeo-secondary">{item.organizationName}</td>
                            <td className="px-5 py-4">
                              {canManageInternalRoles ? (
                                <select value={item.role} onChange={(event) => changeRole(item, event.target.value)} className="rounded-xl border border-mapgeo-line bg-white px-3 py-2 text-xs font-bold text-mapgeo-primary outline-none">
                                  {ROLE_OPTIONS.map((value) => <option key={value} value={value}>{getRoleLabel(value)}</option>)}
                                </select>
                              ) : (
                                <span className="font-semibold text-mapgeo-primary">{item.roleLabel}</span>
                              )}
                            </td>
                            <td className="px-5 py-4 text-mapgeo-secondary">{item.portal}</td>
                            <td className="px-5 py-4"><span className={`rounded-full border px-3 py-1.5 text-[11px] font-bold tracking-wide ${statusClasses(item.statusKey)}`}>{item.status}</span></td>
                            <td className="px-5 py-4 text-mapgeo-secondary">{item.lastLogin}</td>
                            <td className="px-5 py-4">
                              <div className="flex justify-end gap-2">
                                <button type="button" onClick={() => openUserAction("reset", item)} disabled={resetDisabled} title={resetDisabled ? "Réservé aux administrateurs pour les comptes internes" : "Réinitialiser l’accès"} className="rounded-xl border border-mapgeo-line bg-white px-3 py-2 text-xs font-bold text-mapgeo-primary hover:bg-mapgeo-ivory disabled:cursor-not-allowed disabled:opacity-50">Réinitialiser</button>
                                {item.isActive ? (
                                  <button type="button" onClick={() => openUserAction("deactivate", item)} disabled={deactivateDisabled} title={item.id === user?.id ? "Vous ne pouvez pas désactiver votre propre compte" : "Désactiver"} className="rounded-xl border border-mapgeo-line bg-white px-3 py-2 text-xs font-bold text-mapgeo-primary hover:bg-mapgeo-ivory disabled:cursor-not-allowed disabled:opacity-50">Désactiver</button>
                                ) : (
                                  <button type="button" onClick={() => openUserAction("activate", item)} disabled={resetDisabled} className="rounded-xl border border-mapgeo-line bg-white px-3 py-2 text-xs font-bold text-mapgeo-primary hover:bg-mapgeo-ivory disabled:cursor-not-allowed disabled:opacity-50">Activer</button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      }) : (
                        <tr>
                          <td colSpan={8} className="px-5 py-8 text-center text-sm font-medium text-mapgeo-secondary/70">Aucun utilisateur ne correspond aux filtres.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>

          <aside className="relative overflow-hidden rounded-3xl bg-hero p-6 text-white shadow-panel">
            <h3 className="text-xs font-extrabold uppercase tracking-[0.18em] text-white/80">Résumé accès</h3>
            <div className="mt-5 space-y-3 border-b border-white/10 pb-5">
              <Summary icon={UsersRound} label="Utilisateurs actifs" value={activeUsersCount} />
              <Summary icon={ShieldCheck} label="Rôle courant" value={getRoleLabel(user?.role)} />
              <Summary icon={Mail} label="Invitations" value={pendingUsersCount} />
              <Summary icon={KeyRound} label="Sécurité" value="Accès par rôle" />
            </div>
            <div className="mt-5 space-y-2">
              {sidebarActions.map((item) => (
                <button key={item.label} type="button" onClick={item.action} className="flex w-full items-center gap-3 rounded-2xl py-2 text-left text-sm font-semibold text-white/90 hover:bg-white/5">
                  <span className="flex-1">{item.label}</span><ChevronRight size={16} className="text-white/60" />
                </button>
              ))}
            </div>
          </aside>
        </section>
      </div>

      {inviteOpen ? (
        <ModalShell title="Inviter un utilisateur" onClose={() => setInviteOpen(false)}>
          <form onSubmit={submitInvite} className="space-y-4 p-6">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <label className="space-y-1 text-sm font-bold text-mapgeo-primary">Prénom
                <input value={inviteForm.first_name} onChange={(event) => updateInviteForm("first_name", event.target.value)} className="mt-1 w-full rounded-2xl border border-mapgeo-line px-4 py-3 text-sm font-medium outline-none focus:border-mapgeo-primary" />
              </label>
              <label className="space-y-1 text-sm font-bold text-mapgeo-primary">Nom
                <input value={inviteForm.last_name} onChange={(event) => updateInviteForm("last_name", event.target.value)} className="mt-1 w-full rounded-2xl border border-mapgeo-line px-4 py-3 text-sm font-medium outline-none focus:border-mapgeo-primary" />
              </label>
            </div>
            <label className="space-y-1 text-sm font-bold text-mapgeo-primary">Adresse e-mail *
              <input type="email" required value={inviteForm.email} onChange={(event) => updateInviteForm("email", event.target.value)} className="mt-1 w-full rounded-2xl border border-mapgeo-line px-4 py-3 text-sm font-medium outline-none focus:border-mapgeo-primary" />
            </label>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <label className="space-y-1 text-sm font-bold text-mapgeo-primary">Rôle
                <select value={inviteForm.role} onChange={(event) => updateInviteForm("role", event.target.value)} className="mt-1 w-full rounded-2xl border border-mapgeo-line bg-white px-4 py-3 text-sm font-medium outline-none focus:border-mapgeo-primary">
                  {availableInviteRoles.map((value) => <option key={value} value={value}>{getRoleLabel(value)}</option>)}
                </select>
              </label>
              <label className="space-y-1 text-sm font-bold text-mapgeo-primary">Société / libellé
                <input value={inviteForm.company_name} onChange={(event) => updateInviteForm("company_name", event.target.value)} className="mt-1 w-full rounded-2xl border border-mapgeo-line px-4 py-3 text-sm font-medium outline-none focus:border-mapgeo-primary" />
              </label>
            </div>
            {inviteForm.role === "client" ? (
              <label className="space-y-1 text-sm font-bold text-mapgeo-primary">Organisation client *
                <select required value={inviteForm.organization} onChange={(event) => updateInviteForm("organization", event.target.value)} className="mt-1 w-full rounded-2xl border border-mapgeo-line bg-white px-4 py-3 text-sm font-medium outline-none focus:border-mapgeo-primary">
                  <option value="">Sélectionner une organisation</option>
                  {organizations.map((organization) => (
                    <option key={organization.id} value={organization.id}>{organization.name || organization.code} {organization.code ? `(${organization.code})` : ""}</option>
                  ))}
                </select>
              </label>
            ) : null}
            <div className="flex flex-col-reverse gap-3 border-t border-mapgeo-line pt-4 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setInviteOpen(false)} className="rounded-2xl border border-mapgeo-line bg-white px-5 py-3 text-sm font-bold text-mapgeo-primary hover:bg-mapgeo-ivory">Annuler</button>
              <button type="submit" disabled={submittingInvite} className="rounded-2xl bg-mapgeo-primary px-5 py-3 text-sm font-extrabold text-white shadow-soft disabled:cursor-not-allowed disabled:opacity-60">{submittingInvite ? "Invitation…" : "Envoyer l’invitation"}</button>
            </div>
          </form>
        </ModalShell>
      ) : null}

      {pendingAction ? (
        <ModalShell title={actionTitle} onClose={() => setPendingAction(null)}>
          <div className="space-y-4 p-6">
            <p className="text-sm text-mapgeo-secondary">{actionText}</p>
            <p className="rounded-2xl border border-mapgeo-line bg-mapgeo-ivory/70 px-4 py-3 text-sm font-bold text-mapgeo-primary">{pendingAction.user.name} · {pendingAction.user.email}</p>
            <div className="flex flex-col-reverse gap-3 border-t border-mapgeo-line pt-4 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setPendingAction(null)} className="rounded-2xl border border-mapgeo-line bg-white px-5 py-3 text-sm font-bold text-mapgeo-primary hover:bg-mapgeo-ivory">Annuler</button>
              <button type="button" onClick={runUserAction} disabled={actionLoading} className="rounded-2xl bg-mapgeo-primary px-5 py-3 text-sm font-extrabold text-white shadow-soft disabled:cursor-not-allowed disabled:opacity-60">{actionLoading ? "Action…" : "Confirmer"}</button>
            </div>
          </div>
        </ModalShell>
      ) : null}
    </DashboardLayout>
  );
}
