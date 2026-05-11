import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Map,
  FileText,
  Bell,
  LifeBuoy,
  Settings,
  LogOut,
  Compass,
  ShieldCheck,
  Briefcase,
  UsersRound,
} from "lucide-react";
import useAuth from "../../hooks/useAuth";

export function getSidebarMenu({ isClientPortal = false, role } = {}) {
  const canManageClients = !isClientPortal && ["admin", "manager"].includes(role);
  const dashboardPath = isClientPortal ? "/client/dashboard" : "/backoffice/dashboard";

  return [
    { label: isClientPortal ? "Mon espace" : "Pilotage", path: dashboardPath, icon: LayoutDashboard },
    { label: isClientPortal ? "Mes parcelles" : "Parcelles", path: "/parcelles", icon: Map },
    ...(canManageClients ? [{ label: "Clients", path: "/clients", icon: UsersRound }] : []),
    { label: "Documents", path: "/documents", icon: FileText },
    { label: "Notifications", path: "/notifications", icon: Bell },
    { label: "Support", path: "/support", icon: LifeBuoy },
    { label: "Paramètres", path: "/settings", icon: Settings },
  ];
}

export function isActiveMenuItem(pathname, path) {
  if (path === "/parcelles") return pathname.startsWith("/parcelles");
  if (path === "/clients") return pathname.startsWith("/clients");
  if (path === "/documents") return pathname.startsWith("/documents");
  if (path === "/support") return pathname.startsWith("/support");
  if (path === "/settings") return pathname.startsWith("/settings");
  return pathname === path;
}

export default function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout, isClientPortal } = useAuth();
  const [confirmLogoutOpen, setConfirmLogoutOpen] = useState(false);
  const menu = getSidebarMenu({ isClientPortal, role: user?.role });

  const handleLogout = () => {
    setConfirmLogoutOpen(true);
  };

  const confirmLogout = async () => {
    await logout();
    setConfirmLogoutOpen(false);
    navigate("/login", { replace: true });
  };

  return (
    <aside className="relative hidden min-h-dvh w-72 shrink-0 flex-col overflow-hidden bg-mapgeo-primary px-5 py-6 text-white xl:flex 2xl:w-80">
      <div className="absolute inset-y-0 left-0 hidden w-72 bg-hero xl:block 2xl:w-80" aria-hidden="true" />
      <div className="absolute -right-16 -top-20 hidden h-64 w-64 rounded-full bg-white/[0.06] blur-3xl xl:block" aria-hidden="true" />
      <div className="absolute bottom-10 -left-10 hidden h-40 w-40 rounded-full bg-mapgeo-sand/15 blur-3xl xl:block" aria-hidden="true" />

      <div className="relative z-10 mb-8 flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/20 bg-white/10 shadow-soft">
          <Compass size={22} className="text-mapgeo-sand" />
        </div>
        <div>
          <h1 className="text-xl font-extrabold tracking-wide">MAPGEO</h1>
          <p className="mt-1 text-xs uppercase tracking-[0.22em] text-white/70">
            {isClientPortal ? "Portail client" : "Back-office métier"}
          </p>
        </div>
      </div>

      <div className="relative z-10 mb-6 rounded-3xl border border-white/10 bg-white/[0.055] p-5 shadow-soft backdrop-blur">
        <p className="text-xs font-bold uppercase tracking-[0.25em] text-mapgeo-sand/90">
          {isClientPortal ? "Accès privé client" : "Administration sécurisée"}
        </p>
        <h2 className="mt-3 text-lg font-semibold leading-7">
          {isClientPortal
            ? "Parcelles, documents et suivi réunis dans un espace clair."
            : "Pilotage multi-clients, supervision et contrôle qualité."}
        </h2>
        <p className="mt-3 text-sm leading-6 text-white/70">
          {isClientPortal
            ? `Client connecté : ${user?.client_code || "code non défini"}`
            : "Vue filtrée selon votre périmètre MAPGEO."}
        </p>
      </div>

      <nav className="relative z-10 flex-1 space-y-1.5" aria-label="Navigation principale">
        {menu.map((item) => {
          const Icon = item.icon;
          const active = isActiveMenuItem(location.pathname, item.path);

          return (
            <Link
              key={item.path}
              to={item.path}
              aria-current={active ? "page" : undefined}
              className={`group flex items-center gap-3 rounded-2xl px-3.5 py-3 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70 ${
                active
                  ? "bg-white text-mapgeo-primary shadow-soft"
                  : "text-white/80 hover:bg-white/10 hover:text-white"
              }`}
            >
              <span
                className={`flex h-9 w-9 items-center justify-center rounded-xl transition ${
                  active ? "bg-mapgeo-ivory" : "bg-white/10 group-hover:bg-white/10"
                }`}
              >
                <Icon size={18} />
              </span>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="relative z-10 mb-4 rounded-3xl border border-white/10 bg-white/[0.045] p-5">
        <div className="flex items-center gap-3 text-white/90">
          {isClientPortal ? <ShieldCheck size={18} /> : <Briefcase size={18} />}
          <p className="font-semibold">{isClientPortal ? "Isolation client active" : "Vue portefeuille active"}</p>
        </div>
        <p className="mt-3 text-sm leading-6 text-white/75">
          {isClientPortal
            ? "Les données affichées restent limitées au propriétaire connecté."
            : "Les rôles internes sont filtrés selon leur périmètre d’organisation."}
        </p>
      </div>

      <button
        type="button"
        onClick={handleLogout}
        className="relative z-10 mt-auto flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-semibold text-white/80 transition hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
      >
        <LogOut size={18} />
        <span>Déconnexion</span>
      </button>

      {confirmLogoutOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-mapgeo-primary/45 px-4 backdrop-blur-sm" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-3xl border border-mapgeo-line bg-white p-6 text-mapgeo-primary shadow-panel">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-mapgeo-sand/15">
                <LogOut size={21} />
              </div>
              <div>
                <h2 className="text-xl font-extrabold">Voulez-vous vraiment vous déconnecter ?</h2>
                <p className="mt-2 text-sm leading-6 text-mapgeo-secondary/75">
                  Votre session locale sera fermée et vous serez redirigé vers la page de connexion.
                </p>
              </div>
            </div>

            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setConfirmLogoutOpen(false)}
                className="inline-flex justify-center rounded-2xl border border-mapgeo-line bg-white px-5 py-3 text-sm font-extrabold text-mapgeo-primary transition hover:bg-mapgeo-ivory"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={confirmLogout}
                className="inline-flex justify-center rounded-2xl bg-mapgeo-primary px-5 py-3 text-sm font-extrabold text-white shadow-panel transition hover:bg-mapgeo-primary"
              >
                Se déconnecter
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </aside>
  );
}
