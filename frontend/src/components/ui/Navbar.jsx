import { Bell, ChevronRight, LogOut, Menu, Search, Settings, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import useNotifications from "../../hooks/useNotifications";
import useAuth from "../../hooks/useAuth";
import { getSidebarMenu, isActiveMenuItem } from "./Sidebar";

export default function Navbar({ title, subtitle }) {
  const { unreadCount = 0 } = useNotifications();
  const { user, isClientPortal, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!location.pathname.startsWith("/parcelles")) return;
    setQuery(searchParams.get("q") || "");
  }, [location.pathname, searchParams]);

  const displayName = useMemo(
    () => user?.display_name || [user?.first_name, user?.last_name].filter(Boolean).join(" ") || user?.username || "Utilisateur",
    [user],
  );

  const menu = useMemo(
    () => getSidebarMenu({ isClientPortal, role: user?.role }),
    [isClientPortal, user?.role],
  );

  // Chargement de la photo de profil stockée localement
  const avatarUrl = useMemo(() => {
    try {
      const key = String(user?.id || user?.username || user?.email || "current-user");
      const stored = window.localStorage.getItem("mapgeo_profile_avatars");
      if (!stored) return "";
      return JSON.parse(stored)?.[key] || "";
    } catch { return ""; }
  }, [user]);

  const handleSubmit = (event) => {
    event.preventDefault();
    const value = query.trim();
    navigate(value ? `/parcelles?q=${encodeURIComponent(value)}` : "/parcelles");
  };

  const confirmLogout = async () => {
    await logout();
    setLogoutConfirmOpen(false);
    setMobileMenuOpen(false);
    navigate("/login", { replace: true });
  };

  return (
    <header className="relative z-30 border-b border-mapgeo-line/80 bg-white/[0.92] shadow-none backdrop-blur-xl md:sticky md:top-0">
      <div className="px-4 py-4 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[0.68rem] font-bold uppercase tracking-[0.22em] text-mapgeo-secondary/60">
                {isClientPortal ? "Portail client sécurisé" : "Console opérationnelle et cartographique"}
              </p>
              <h2 className="mt-1.5 truncate text-2xl font-extrabold tracking-tight text-mapgeo-primary md:text-3xl">
                {title}
              </h2>
              {subtitle ? <p className="mt-1.5 max-w-3xl text-sm leading-6 text-mapgeo-secondary/70">{subtitle}</p> : null}
            </div>

            <button
              type="button"
              onClick={() => setMobileMenuOpen((value) => !value)}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-mapgeo-line bg-white text-mapgeo-primary shadow-soft transition hover:bg-mapgeo-ivory focus:outline-none focus-visible:ring-4 focus-visible:ring-mapgeo-primary/10 xl:hidden"
              aria-label={mobileMenuOpen ? "Fermer le menu" : "Ouvrir le menu"}
              aria-expanded={mobileMenuOpen}
            >
              {mobileMenuOpen ? <X size={19} /> : <Menu size={19} />}
            </button>
          </div>

          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <form
              onSubmit={handleSubmit}
              className="flex min-h-12 min-w-0 items-center gap-3 rounded-2xl border border-mapgeo-line bg-mapgeo-ivory/80 px-4 py-3 shadow-sm transition focus-within:border-mapgeo-primary/30 focus-within:bg-white focus-within:ring-4 focus-within:ring-mapgeo-primary/5 lg:w-[25rem]"
            >
              <Search size={18} className="shrink-0 text-mapgeo-secondary/50" />
              <input
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Rechercher une parcelle…"
                className="w-full min-w-0 bg-transparent text-sm text-mapgeo-primary outline-none placeholder:text-mapgeo-secondary/40"
              />
            </form>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => navigate("/notifications")}
                className="relative inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-mapgeo-line bg-white text-mapgeo-primary shadow-soft transition hover:bg-mapgeo-ivory focus:outline-none focus-visible:ring-4 focus-visible:ring-mapgeo-primary/10"
                aria-label="Ouvrir les notifications"
              >
                <Bell size={18} />
                {unreadCount > 0 ? (
                  <span className="absolute -right-2 -top-2 flex h-6 min-w-6 items-center justify-center rounded-full bg-mapgeo-sand px-1.5 text-xs font-extrabold text-mapgeo-primary shadow-soft">
                    {unreadCount}
                  </span>
                ) : null}
              </button>

              <Link to="/settings" className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl border border-mapgeo-line bg-white px-3 py-2.5 shadow-soft transition hover:border-mapgeo-primary/20 hover:bg-mapgeo-ivory/60 lg:min-w-[15rem]" title="Mes paramètres">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-mapgeo-primary text-sm font-extrabold text-white">
                  {avatarUrl
                    ? <img src={avatarUrl} alt="Avatar" className="h-full w-full object-cover" />
                    : (displayName[0] || "U").toUpperCase()
                  }
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[0.65rem] font-bold uppercase tracking-[0.18em] text-mapgeo-secondary/60">
                    {isClientPortal ? "Client" : "Opérateur"}
                  </p>
                  <p className="truncate text-sm font-bold text-mapgeo-primary">{displayName}</p>
                  <p className="mt-0.5 truncate text-xs text-mapgeo-secondary/60">
                    {isClientPortal ? `ID ${user?.client_code || "—"}` : user?.role || "Compte"}
                  </p>
                </div>
                <Settings size={15} className="hidden shrink-0 text-mapgeo-secondary/50 sm:block" />
              </Link>
            </div>
          </div>
        </div>

        {mobileMenuOpen ? (
          <nav className="mt-4 grid grid-cols-1 gap-2 rounded-3xl border border-mapgeo-line bg-white p-2 shadow-soft sm:grid-cols-2 lg:grid-cols-3 xl:hidden" aria-label="Navigation mobile">
            {menu.map((item) => {
              const Icon = item.icon;
              const active = isActiveMenuItem(location.pathname, item.path);

              return (
                <Link
                  key={item.path}
                  to={item.path}
                  aria-current={active ? "page" : undefined}
                  className={`flex items-center gap-3 rounded-2xl px-3 py-3 text-sm font-bold transition focus:outline-none focus-visible:ring-4 focus-visible:ring-mapgeo-primary/10 ${
                    active
                      ? "bg-mapgeo-primary text-white shadow-soft"
                      : "text-mapgeo-primary hover:bg-mapgeo-ivory"
                  }`}
                >
                  <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${active ? "bg-white/10" : "bg-mapgeo-ivory"}`}>
                    <Icon size={17} />
                  </span>
                  {item.label}
                </Link>
              );
            })}
            <button
              type="button"
              onClick={() => setLogoutConfirmOpen(true)}
              className="flex items-center gap-3 rounded-2xl px-3 py-3 text-sm font-bold text-mapgeo-primary transition hover:bg-mapgeo-ivory focus:outline-none focus-visible:ring-4 focus-visible:ring-mapgeo-primary/10"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-mapgeo-ivory">
                <LogOut size={17} />
              </span>
              Déconnexion
            </button>
          </nav>
        ) : null}
      </div>

      {logoutConfirmOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-mapgeo-primary/35 px-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Confirmation de déconnexion">
          <div className="w-full max-w-sm rounded-3xl border border-mapgeo-line bg-white p-6 shadow-panel">
            <h3 className="text-lg font-extrabold text-mapgeo-primary">Se déconnecter ?</h3>
            <p className="mt-2 text-sm leading-6 text-mapgeo-secondary/75">
              Votre session MAPGEO sera fermée sur cet appareil.
            </p>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setLogoutConfirmOpen(false)}
                className="rounded-2xl border border-mapgeo-line bg-white px-4 py-3 text-sm font-bold text-mapgeo-primary transition hover:bg-mapgeo-ivory"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={confirmLogout}
                className="rounded-2xl bg-mapgeo-primary px-4 py-3 text-sm font-extrabold text-white shadow-panel transition hover:bg-mapgeo-primary/95"
              >
                Se déconnecter
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </header>
  );
}
