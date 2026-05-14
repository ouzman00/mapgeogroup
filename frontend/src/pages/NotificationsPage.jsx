import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  BellRing,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  CircleEllipsis,
  Clock3,
  ExternalLink,
  FileText,
  Headphones,
  Inbox,
  ListChecks,
  Mail,
  Map,
  RefreshCcw,
  Search,
  Settings,
  ShieldAlert,
  Trash2,
  UserRound,
} from "lucide-react";
import DashboardLayout from "../layouts/DashboardLayout";
import useAuth from "../hooks/useAuth";
import useNotifications from "../hooks/useNotifications";
import { getErrorMessage } from "../services/responseUtils";
import { getRoleLabel } from "../constants/roleConstants";
import LoadingState from "../components/ui/LoadingState";

const tabOptions = ["Toutes", "Non lues", "Alertes", "Documents", "Parcelles", "Support"];
const groupOrder = ["Aujourd’hui", "Hier", "Cette semaine", "Plus ancien"];

function formatNumber(value) {
  return new Intl.NumberFormat("fr-FR").format(Number(value || 0));
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function priorityFromType(notification) {
  const raw = String(notification.priority || notification.severity || notification.notification_type || notification.type || "info").toLowerCase();

  if (raw.includes("success") || raw.includes("succ") || raw.includes("valid")) return "Succès";
  if (raw.includes("error") || raw.includes("erreur") || raw.includes("critical") || raw.includes("critique")) return "Erreur";
  if (raw.includes("warning") || raw.includes("alerte") || raw.includes("warn")) return "Alerte";

  return "Information";
}

function typeFromNotification(notification) {
  const raw = String(notification.notification_type || notification.type || "info").toLowerCase();

  if (raw.includes("document")) return "Document";
  if (raw.includes("parcel") || raw.includes("parcelle")) return "Parcelle";
  if (raw.includes("support") || raw.includes("ticket")) return "Support";
  if (raw.includes("client") || raw.includes("user")) return "Client";

  return "Information";
}

function hrefFromNotification(notification) {
  const relatedType = String(notification.related_type || "").toLowerCase();
  const relatedId = notification.related_id || notification.object_id || notification.target_id;
  const notificationType = typeFromNotification(notification);
  const explicitHref = notification.href || notification.url || notification.target_url || notification.related_url;

  // Les notifications anciennes peuvent pointer vers une parcelle archivée,
  // supprimée ou hors périmètre utilisateur. On évite alors d'ouvrir
  // directement une URL détail susceptible de produire un 404 visible.
  if (explicitHref) {
    if (notificationType === "Parcelle" && /^\/(?:parcels|parcelles)\/\d+(?:\/carto)?(?:[?#].*)?$/.test(String(explicitHref))) {
      return "/parcelles/carto";
    }
    return explicitHref;
  }

  if (relatedId) {
    if (relatedType.includes("document")) return `/documents/${relatedId}`;
    if (relatedType.includes("support") || relatedType.includes("ticket")) return `/support/${relatedId}`;
    if (relatedType.includes("parcel") || relatedType.includes("parcelle")) return "/parcelles/carto";
  }

  const type = typeFromNotification(notification);
  if (type === "Document") return "/documents";
  if (type === "Parcelle") return "/parcelles";
  if (type === "Support") return "/support";
  if (type === "Client") return "/clients";

  return "/notifications";
}

function actionLabelFromType(type) {
  if (type === "Document") return "Ouvrir le document";
  if (type === "Parcelle") return "Ouvrir la parcelle";
  if (type === "Support") return "Ouvrir le ticket";
  if (type === "Client") return "Ouvrir le client";
  return "Ouvrir l’élément";
}

function formatNotificationTime(value) {
  if (!value) return "—";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) {
    return date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  }

  return date.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
}

function groupFromDate(value) {
  if (!value) return "Plus ancien";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Plus ancien";

  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const yesterday = new Date(startOfToday);
  yesterday.setDate(startOfToday.getDate() - 1);
  const startOfWeek = new Date(startOfToday);
  const day = startOfWeek.getDay() || 7;
  startOfWeek.setDate(startOfToday.getDate() - day + 1);

  if (date >= startOfToday) return "Aujourd’hui";
  if (date >= yesterday && date < startOfToday) return "Hier";
  if (date >= startOfWeek) return "Cette semaine";

  return "Plus ancien";
}

function iconForType(type, priority) {
  if (priority === "Erreur") return ShieldAlert;
  if (type === "Document") return FileText;
  if (type === "Parcelle") return Map;
  if (type === "Support") return Headphones;
  if (type === "Client") return UserRound;
  return BellRing;
}

function iconClassForPriority(priority) {
  if (priority === "Erreur") return "bg-mapgeo-primary text-white";
  if (priority === "Alerte") return "bg-mapgeo-sand text-white";
  if (priority === "Succès") return "bg-mapgeo-primary text-white";
  return "bg-mapgeo-primary text-white";
}

function normalizeNotification(notification, index, localReadIds) {
  const type = notification.type || typeFromNotification(notification);
  const priority = notification.priority || priorityFromType(notification);
  const Icon = notification.icon || iconForType(type, priority);

  return {
    id: notification.id || `notification-${index}`,
    title: notification.title || "Notification",
    message: notification.message || notification.body || "Mise à jour disponible.",
    type,
    priority,
    createdLabel: notification.createdLabel || formatNotificationTime(notification.created_at),
    created_at: notification.created_at,
    group: notification.group || groupFromDate(notification.created_at),
    is_read: Boolean(notification.is_read || localReadIds.has(notification.id)),
    href: hrefFromNotification(notification),
    actionLabel: notification.actionLabel || actionLabelFromType(type),
    icon: Icon,
    iconClass: notification.iconClass || iconClassForPriority(priority),
    isMock: Boolean(notification.isMock || !notification.id),
  };
}

function priorityClasses(priority) {
  if (priority === "Erreur") return "border-mapgeo-line bg-mapgeo-sand/10 text-mapgeo-primary";
  if (priority === "Alerte") return "border-mapgeo-line bg-mapgeo-sand/10 text-mapgeo-primary";
  if (priority === "Succès") return "border-mapgeo-line bg-mapgeo-primary/6 text-mapgeo-primary";
  return "border-mapgeo-sand/35 bg-mapgeo-sand/15 text-mapgeo-primary";
}

function tabMatchesNotification(tab, notification) {
  if (tab === "Toutes") return true;
  if (tab === "Non lues") return !notification.is_read;
  if (tab === "Alertes") return ["Alerte", "Erreur"].includes(notification.priority);
  if (tab === "Documents") return notification.type === "Document";
  if (tab === "Parcelles") return notification.type === "Parcelle";
  if (tab === "Support") return notification.type === "Support";
  return true;
}

function isWithinPeriod(notification, period) {
  if (!period || period === "all") return true;

  const date = new Date(notification.created_at || 0);
  if (Number.isNaN(date.getTime())) return false;

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfWeek = new Date(startOfToday);
  const day = startOfWeek.getDay() || 7;
  startOfWeek.setDate(startOfToday.getDate() - day + 1);
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  if (period === "today") return date >= startOfToday;
  if (period === "week") return date >= startOfWeek;
  if (period === "month") return date >= startOfMonth;
  if (period === "7days") {
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(now.getDate() - 7);
    return date >= sevenDaysAgo;
  }

  return true;
}

function KpiCard({ icon: Icon, label, value, description, action, onClick, tone = "blue" }) {
  const tones = {
    blue: "bg-mapgeo-sand/15 text-mapgeo-primary",
    red: "bg-mapgeo-sand/10 text-mapgeo-primary",
    purple: "bg-mapgeo-sand/15 text-mapgeo-primary",
    teal: "bg-mapgeo-sand/15 text-mapgeo-primary",
  };

  return (
    <article className="group rounded-3xl border border-mapgeo-line bg-white p-6 shadow-soft transition hover:border-mapgeo-sand/50">
      <div className="flex items-start gap-4">
        <div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl ${tones[tone] || tones.blue}`}>
          <Icon size={27} strokeWidth={1.9} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-mapgeo-secondary/70">{label}</p>
          <p className="mt-2 text-3xl font-extrabold tracking-tight text-mapgeo-primary">{value}</p>
          <p className="mt-1 text-sm text-mapgeo-secondary/70">{description}</p>
        </div>
      </div>

      <div className="mt-5 border-t border-mapgeo-line pt-4">
        <button type="button" onClick={onClick} className="inline-flex items-center gap-2 text-sm font-bold text-mapgeo-primary transition group-hover:gap-3">
          {action} <ChevronRight size={16} />
        </button>
      </div>
    </article>
  );
}

function FilterTabs({ activeTab, setActiveTab, filters, setFilters, onReset }) {
  const update = (name, value) => setFilters({ ...filters, [name]: value });

  return (
    <section className="rounded-3xl border border-mapgeo-line bg-white p-4 shadow-soft">
      <div className="flex flex-col gap-4 2xl:flex-row 2xl:items-end 2xl:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {tabOptions.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`inline-flex h-11 items-center gap-2 rounded-2xl px-4 text-sm font-extrabold transition ${
                activeTab === tab
                  ? "bg-mapgeo-primary text-white shadow-panel"
                  : "border border-transparent bg-white text-mapgeo-primary hover:border-mapgeo-line hover:bg-mapgeo-ivory"
              }`}
            >
              {tab === "Toutes" ? <ListChecks size={16} /> : null}
              {tab === "Non lues" ? <span className="h-2.5 w-2.5 rounded-full bg-mapgeo-primary" /> : null}
              {tab === "Alertes" ? <AlertTriangle size={16} className="text-mapgeo-sand" /> : null}
              {tab === "Documents" ? <FileText size={16} className="text-mapgeo-primary" /> : null}
              {tab === "Parcelles" ? <Map size={16} className="text-mapgeo-primary" /> : null}
              {tab === "Support" ? <Headphones size={16} className="text-mapgeo-primary" /> : null}
              {tab}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1.1fr_1.4fr_auto] 2xl:min-w-[820px]">
          <SelectField label="Priorité" value={filters.priority} onChange={(value) => update("priority", value)}>
            <option value="">Toutes</option>
            <option value="Information">Information</option>
            <option value="Succès">Succès</option>
            <option value="Alerte">Alerte</option>
            <option value="Erreur">Erreur</option>
          </SelectField>

          <SelectField label="Statut" value={filters.status} onChange={(value) => update("status", value)}>
            <option value="">Tous</option>
            <option value="unread">Non lu</option>
            <option value="read">Lu</option>
          </SelectField>

          <SelectField label="Période" value={filters.period} onChange={(value) => update("period", value)} icon={CalendarDays}>
            <option value="">Toutes les périodes</option>
            <option value="7days">7 derniers jours</option>
            <option value="today">Aujourd’hui</option>
            <option value="week">Cette semaine</option>
            <option value="month">Ce mois-ci</option>
            <option value="all">Toutes les dates</option>
          </SelectField>

          <label className="space-y-1.5 sm:col-span-2 lg:col-span-1">
            <span className="text-xs font-bold text-mapgeo-primary/80">Recherche</span>
            <div className="flex h-11 items-center gap-2 rounded-2xl border border-mapgeo-line bg-white px-3 text-sm text-mapgeo-secondary shadow-sm">
              <Search size={16} className="text-mapgeo-secondary/60" />
              <input
                type="search"
                value={filters.query || ""}
                onChange={(event) => update("query", event.target.value)}
                placeholder="Titre, message, type..."
                className="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm outline-none placeholder:text-mapgeo-secondary/45 focus:shadow-none"
              />
            </div>
          </label>

          <div className="flex items-end">
            <button
              type="button"
              onClick={onReset}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-mapgeo-line bg-white px-4 text-sm font-bold text-mapgeo-primary shadow-sm transition hover:bg-mapgeo-ivory lg:w-auto"
            >
              <RefreshCcw size={16} /> Réinitialiser
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function SelectField({ label, value, onChange, children, icon: Icon }) {
  return (
    <label className="space-y-1.5">
      <span className="text-xs font-bold text-mapgeo-primary/80">{label}</span>
      <div className="flex h-11 items-center gap-2 rounded-2xl border border-mapgeo-line bg-white px-3 text-sm text-mapgeo-secondary shadow-sm">
        {Icon ? <Icon size={16} className="text-mapgeo-secondary/60" /> : null}
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm outline-none focus:shadow-none"
        >
          {children}
        </select>
      </div>
    </label>
  );
}

function NotificationsFeed({ groups, loading, error, selectedIds, onToggleSelected, onToggleVisibleSelection, onDeleteSelected, onDeleteNotification, onMarkAsRead, onOpenNotification, onReset }) {
  const handleOpenClick = (event, item) => {
    event.preventDefault();
    onOpenNotification(item);
  };

  const visibleItems = groupOrder.flatMap((group) => groups[group] || []);
  const selectableItems = visibleItems.filter((item) => !item.isMock);
  const selectedCount = selectedIds.size;
  const visibleSelected = selectableItems.filter((item) => selectedIds.has(item.id)).length;
  const allVisibleSelected = selectableItems.length > 0 && visibleSelected === selectableItems.length;

  return (
    <section className="rounded-3xl border border-mapgeo-line bg-white shadow-soft">
      <div className="flex flex-col gap-3 border-b border-mapgeo-line p-6 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h3 className="text-2xl font-extrabold text-mapgeo-primary">Centre de notifications</h3>
          <p className="mt-1 text-sm text-mapgeo-secondary/70">Suivez les événements importants et les actions à traiter.</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <label className="inline-flex items-center gap-2 rounded-2xl border border-mapgeo-line bg-white px-3 py-2 text-xs font-extrabold text-mapgeo-primary shadow-sm">
            <input
              type="checkbox"
              checked={allVisibleSelected}
              disabled={!selectableItems.length}
              onChange={() => onToggleVisibleSelection(selectableItems, !allVisibleSelected)}
            />
            Tout sélectionner
          </label>
          <button
            type="button"
            onClick={onDeleteSelected}
            disabled={!selectedCount}
            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-red-100 bg-white px-3 py-2 text-xs font-extrabold text-red-700 shadow-sm transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Trash2 size={15} /> Supprimer {selectedCount ? `(${selectedCount})` : ""}
          </button>
          <div className="inline-flex items-center gap-2 text-xs font-medium text-mapgeo-secondary/70">
            Données synchronisées avec le backend
            <RefreshCcw size={15} className="text-mapgeo-primary" />
          </div>
        </div>
      </div>

      {loading ? (
        <div className="p-6">
          <LoadingState
            title="Chargement des notifications"
            message="Mise à jour des alertes et des informations récentes."
            compact
          />
        </div>
      ) : null}

      {error ? (
        <div className="m-6 rounded-2xl border border-mapgeo-sand/40 bg-mapgeo-sand/10 p-4 text-sm font-medium text-mapgeo-primary">{error}</div>
      ) : null}

      {!loading && !error && groupOrder.every((group) => !groups[group]?.length) ? (
        <div className="p-6">
          <div className="rounded-3xl border border-mapgeo-line bg-mapgeo-ivory/30 p-8 text-center">
            <Inbox className="mx-auto text-mapgeo-secondary/40" size={34} />
            <p className="mt-3 font-bold text-mapgeo-primary">Aucune notification à afficher</p>
            <p className="mt-1 text-sm text-mapgeo-secondary/70">Modifie les filtres ou reviens plus tard.</p>
          </div>
        </div>
      ) : null}

      {!loading && !error ? (
        <div className="divide-y divide-mapgeo-line">
          {groupOrder.map((group) => {
            const items = groups[group] || [];
            if (!items.length) return null;

            return (
              <div key={group} className="p-5 sm:p-6">
                <div className="mb-3 flex items-center gap-2">
                  <span className="h-5 w-1 rounded-full bg-mapgeo-primary" />
                  <h4 className="text-sm font-extrabold text-mapgeo-primary">{group}</h4>
                </div>

                <div className="space-y-2">
                  {items.map((item) => {
                    const Icon = item.icon;

                    return (
                      <article
                        key={item.id}
                        className={`flex min-w-0 flex-col gap-4 rounded-2xl border px-4 py-4 transition hover:bg-mapgeo-ivory/40 xl:flex-row xl:items-center ${
                          item.is_read ? "border-transparent" : "border-mapgeo-sand/35 bg-mapgeo-sand/15"
                        }`}
                      >
                        <div className="flex min-w-0 flex-1 items-start gap-3">
                          <label className="mt-3 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border border-mapgeo-line bg-white shadow-sm">
                            <input
                              type="checkbox"
                              checked={selectedIds.has(item.id)}
                              disabled={item.isMock}
                              onChange={() => onToggleSelected(item.id)}
                              aria-label={`Sélectionner ${item.title}`}
                            />
                          </label>
                          <span className={`mt-4 h-2.5 w-2.5 shrink-0 rounded-full ${item.is_read ? "bg-mapgeo-sand/45" : "bg-mapgeo-primary"}`} />
                          <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${item.iconClass}`}>
                            <Icon size={20} />
                          </span>
                          <div className="min-w-0 flex-1">
                            <h5 className="break-words font-extrabold text-mapgeo-primary">{item.title}</h5>
                            <p className="mt-1 break-words text-sm leading-6 text-mapgeo-secondary/75">{item.message}</p>
                          </div>
                        </div>

                        <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm xl:max-w-[660px] xl:justify-end">
                          <span className="w-fit shrink-0 whitespace-nowrap font-semibold text-mapgeo-secondary">{item.type}</span>
                          <span className={`inline-flex w-fit shrink-0 justify-center whitespace-nowrap rounded-full border px-3 py-1.5 text-[11px] font-bold tracking-wide ${priorityClasses(item.priority)}`}>
                            {item.priority}
                          </span>
                          <span className="w-fit shrink-0 whitespace-nowrap font-medium text-mapgeo-secondary/75">{item.createdLabel}</span>
                          <span className={`inline-flex w-fit shrink-0 justify-center whitespace-nowrap rounded-xl px-2.5 py-1 text-xs font-bold ${item.is_read ? "bg-mapgeo-ivory text-mapgeo-secondary/75" : "bg-mapgeo-sand/15 text-mapgeo-primary"}`}>
                            {item.is_read ? "Lu" : "Non lu"}
                          </span>
                          {!item.is_read ? (
                            <button
                              type="button"
                              onClick={() => onMarkAsRead(item)}
                              className="w-fit shrink-0 whitespace-nowrap rounded-xl border border-mapgeo-line bg-white px-3 py-2 text-xs font-bold text-mapgeo-primary shadow-sm transition hover:bg-mapgeo-ivory"
                            >
                              Marquer comme lu
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => onDeleteNotification(item)}
                            disabled={item.isMock}
                            className="inline-flex w-fit shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl border border-red-100 bg-white px-3 py-2 text-xs font-bold text-red-700 shadow-sm transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <Trash2 size={13} /> Supprimer
                          </button>
                          <Link
                            to={item.href}
                            onClick={(event) => handleOpenClick(event, item)}
                            className="inline-flex w-fit shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl border border-mapgeo-line bg-white px-3 py-2 text-xs font-bold text-mapgeo-primary shadow-sm transition hover:bg-mapgeo-ivory"
                          >
                            {item.actionLabel} <ExternalLink size={13} />
                          </Link>
                          <Link
                            to={item.href}
                            onClick={(event) => handleOpenClick(event, item)}
                            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-mapgeo-line bg-white text-mapgeo-secondary transition hover:bg-mapgeo-ivory"
                            aria-label="Ouvrir les actions de notification"
                            title="Ouvrir l’élément lié"
                          >
                            <CircleEllipsis size={17} />
                          </Link>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {!loading && !error ? (
        <div className="flex justify-center border-t border-mapgeo-line px-6 py-5">
          <button type="button" onClick={onReset} className="inline-flex items-center gap-2 text-sm font-extrabold text-mapgeo-primary transition hover:gap-3">
            Réinitialiser les filtres <ChevronRight size={16} />
          </button>
        </div>
      ) : null}
    </section>
  );
}

function AlertsSummary({ metrics, priorityStats, user, isClientPortal, onMarkAllRead, onOpenCritical }) {
  const quickActions = [
    { label: "Tout marquer comme lu", icon: CheckCircle2, onClick: onMarkAllRead },
    { label: isClientPortal ? "Voir mes alertes" : "Ouvrir les alertes critiques", icon: AlertTriangle, onClick: onOpenCritical },
    { label: isClientPortal ? "Voir mes demandes support" : "Voir les tickets support", icon: Headphones, href: "/support" },
    { label: "Accéder aux paramètres d’alerte", icon: Settings, href: "/settings" },
  ];

  return (
    <aside className="relative overflow-hidden rounded-3xl bg-hero p-6 text-white shadow-panel">
      <div className="absolute -right-16 -top-16 h-44 w-44 rounded-full bg-white/[0.06] blur-3xl" />
      <div className="relative">
        <h3 className="text-xs font-extrabold uppercase tracking-[0.18em] text-white/80">{isClientPortal ? "Résumé de mes notifications" : "Résumé des alertes"}</h3>

        <div className="mt-5 space-y-3 border-b border-white/10 pb-5">
          <SummaryMetric icon={Mail} label="Non lues" value={formatNumber(metrics.unread)} />
          <SummaryMetric icon={AlertTriangle} label={isClientPortal ? "Alertes" : "Critiques"} value={formatNumber(metrics.critical)} />
          <SummaryMetric icon={FileText} label="Documents" value={formatNumber(metrics.documents)} />
          <SummaryMetric icon={Headphones} label="Support" value={formatNumber(metrics.support)} />
          <SummaryMetric icon={Clock3} label="Session" value={user?.username || user?.email || "—"} />
        </div>

        <div className="mt-5 border-b border-white/10 pb-5">
          <h4 className="text-xs font-extrabold uppercase tracking-[0.18em] text-white/75">Répartition par priorité</h4>
          <div className="mt-3 space-y-3">
            <PriorityMetric label="Information" value={priorityStats.Information} color="bg-mapgeo-sand" />
            <PriorityMetric label="Succès" value={priorityStats.Succès} color="bg-mapgeo-sand" />
            <PriorityMetric label="Alerte" value={priorityStats.Alerte} color="bg-mapgeo-sand" />
            <PriorityMetric label="Erreur" value={priorityStats.Erreur} color="bg-mapgeo-sand" />
          </div>
        </div>

        <div className="mt-5 border-b border-white/10 pb-5">
          <h4 className="text-xs font-extrabold uppercase tracking-[0.18em] text-white/75">Actions rapides</h4>
          <div className="mt-3 space-y-2">
            {quickActions.map((action) => {
              const Icon = action.icon;
              const className = "flex w-full items-center gap-3 rounded-2xl py-2 text-left text-sm font-semibold text-white/90 transition hover:bg-white/5";
              const content = (
                <>
                  <Icon size={17} className="text-white/70" />
                  <span className="flex-1">{action.label}</span>
                  <ChevronRight size={16} className="text-white/60" />
                </>
              );

              if (action.href) {
                return (
                  <Link key={action.label} to={action.href} className={className}>
                    {content}
                  </Link>
                );
              }

              return (
                <button key={action.label} type="button" onClick={action.onClick} className={className}>
                  {content}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-white/10 p-4">
            <p className="text-xs uppercase tracking-[0.14em] text-white/50">Portail</p>
            <p className="mt-1 font-extrabold">{isClientPortal ? "Client" : "Interne"}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/10 p-4">
            <p className="text-xs uppercase tracking-[0.14em] text-white/50">Rôle</p>
            <p className="mt-1 font-extrabold">{isClientPortal ? "Client" : getRoleLabel(user?.role)}</p>
          </div>
        </div>
      </div>
    </aside>
  );
}

function SummaryMetric({ icon: Icon, label, value }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <Icon size={17} className="text-white/70" />
      <span className="flex-1 text-white/80">{label}</span>
      <span className="font-extrabold text-white">{value}</span>
    </div>
  );
}

function PriorityMetric({ label, value, color }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className={`h-2.5 w-2.5 rounded-full ${color}`} />
      <span className="flex-1 text-white/80">{label}</span>
      <span className="font-extrabold text-white">{formatNumber(value)}</span>
    </div>
  );
}

export default function NotificationsPage() {
  const { user, isClientPortal } = useAuth();
  const { notifications, loading, fetchNotifications, markAsRead, markAllAsRead, deleteNotifications, unreadCount } = useNotifications();
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("Toutes");
  const [filters, setFilters] = useState({ priority: "", status: "", period: "", query: "" });
  const [localReadIds, setLocalReadIds] = useState(new Set());
  const [selectedIds, setSelectedIds] = useState(new Set());
  const navigate = useNavigate();

  const normalizedNotifications = useMemo(() => {
    return asArray(notifications)
      .map((notification, index) => normalizeNotification(notification, index, localReadIds))
      .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  }, [notifications, localReadIds]);

  const filteredNotifications = useMemo(() => {
    return normalizedNotifications.filter((notification) => {
      const matchesTab = tabMatchesNotification(activeTab, notification);
      const matchesPriority = !filters.priority || notification.priority === filters.priority;
      const matchesStatus = !filters.status || (filters.status === "read" ? notification.is_read : !notification.is_read);
      const matchesPeriod = isWithinPeriod(notification, filters.period);
      const query = String(filters.query || "").trim().toLowerCase();
      const searchableText = [notification.title, notification.message, notification.type, notification.priority]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      const matchesQuery = !query || searchableText.includes(query);

      return matchesTab && matchesPriority && matchesStatus && matchesPeriod && matchesQuery;
    });
  }, [activeTab, filters, normalizedNotifications]);

  const groupedNotifications = useMemo(() => {
    return filteredNotifications.reduce(
      (acc, notification) => {
        const key = groupOrder.includes(notification.group) ? notification.group : "Cette semaine";
        acc[key].push(notification);
        return acc;
      },
      { "Aujourd’hui": [], Hier: [], "Cette semaine": [], "Plus ancien": [] },
    );
  }, [filteredNotifications]);

  const metrics = useMemo(() => {
    const unread = filteredNotifications.filter((item) => !item.is_read).length;
    const critical = filteredNotifications.filter((item) => item.priority === "Erreur" || item.priority === "Alerte").length;
    const documents = filteredNotifications.filter((item) => item.type === "Document").length;
    const support = filteredNotifications.filter((item) => item.type === "Support").length;

    return { unread, critical, documents, support };
  }, [filteredNotifications]);

  const priorityStats = useMemo(() => {
    return filteredNotifications.reduce(
      (acc, notification) => {
        acc[notification.priority] = (acc[notification.priority] || 0) + 1;
        return acc;
      },
      { Information: 0, Succès: 0, Alerte: 0, Erreur: 0 },
    );
  }, [filteredNotifications]);

  const handleMarkAllRead = async () => {
    setError("");
    try {
      if (unreadCount > 0) await markAllAsRead();
      setLocalReadIds(new Set(normalizedNotifications.map((item) => item.id)));
    } catch (err) {
      setError(getErrorMessage(err, "Impossible de mettre à jour les notifications."));
    }
  };

  const handleMarkAsRead = async (notification) => {
    setError("");
    try {
      if (!notification.isMock) await markAsRead(notification.id);
      setLocalReadIds((current) => new Set([...current, notification.id]));
    } catch (err) {
      setError(getErrorMessage(err, "Impossible de marquer la notification comme lue."));
    }
  };

  const toggleSelectedNotification = (id) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleVisibleSelection = (items, shouldSelect) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      items.forEach((item) => {
        if (item.isMock) return;
        if (shouldSelect) next.add(item.id);
        else next.delete(item.id);
      });
      return next;
    });
  };

  const handleDeleteSelected = async () => {
    const ids = [...selectedIds];
    if (!ids.length) return;
    const confirmed = window.confirm(`Supprimer définitivement ${ids.length} notification${ids.length > 1 ? "s" : ""} ?`);
    if (!confirmed) return;
    setError("");
    try {
      await deleteNotifications(ids);
      setSelectedIds(new Set());
    } catch (err) {
      setError(getErrorMessage(err, "Impossible de supprimer les notifications sélectionnées."));
    }
  };

  const handleDeleteNotification = async (notification) => {
    if (notification.isMock) return;
    const confirmed = window.confirm(`Supprimer définitivement la notification « ${notification.title} » ?`);
    if (!confirmed) return;
    setError("");
    try {
      await deleteNotifications([notification.id]);
      setSelectedIds((current) => {
        const next = new Set(current);
        next.delete(notification.id);
        return next;
      });
    } catch (err) {
      setError(getErrorMessage(err, "Impossible de supprimer cette notification."));
    }
  };

  const handleOpenNotification = async (notification) => {
    setError("");

    try {
      if (!notification.is_read) {
        if (!notification.isMock) {
          await markAsRead(notification.id);
        }

        setLocalReadIds((current) => new Set([...current, notification.id]));
      }

      navigate(notification.href || "/notifications");
    } catch (err) {
      setError(getErrorMessage(err, "Impossible de marquer la notification comme lue."));
    }
  };

  const resetFilters = () => {
    setActiveTab("Toutes");
    setFilters({ priority: "", status: "", period: "", query: "" });
    setSelectedIds(new Set());
  };

  return (
    <DashboardLayout
      title={isClientPortal ? "Mes notifications" : "Notifications & alertes"}
      subtitle={isClientPortal ? "Consultez les notifications liées à vos parcelles, documents et demandes support." : "Centralisez les événements, alertes métier et suivis opérationnels dans une vue claire et hiérarchisée."}
    >
      <div className="space-y-6">
        <section className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <nav className="text-sm font-semibold text-mapgeo-primary" aria-label="Fil d’Ariane">
              Accueil <span className="mx-1 text-mapgeo-secondary/40">/</span> Notifications
            </nav>
            <p className="mt-2 max-w-2xl text-sm text-mapgeo-secondary/70 lg:hidden">
              {isClientPortal ? "Consultez les notifications liées à vos parcelles, documents et demandes support." : "Centralisez les événements, alertes métier et suivis opérationnels dans une vue claire et hiérarchisée."}
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={handleMarkAllRead}
              disabled={unreadCount === 0}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-mapgeo-primary px-5 py-3 text-sm font-extrabold text-white shadow-panel transition hover:bg-mapgeo-primary/95 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <CheckCircle2 size={18} /> Tout marquer comme lu
            </button>
            <button
              type="button"
              onClick={handleDeleteSelected}
              disabled={selectedIds.size === 0}
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-red-100 bg-white px-5 py-3 text-sm font-extrabold text-red-700 shadow-soft transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Trash2 size={18} /> Supprimer la sélection{selectedIds.size ? ` (${selectedIds.size})` : ""}
            </button>
            <button
              type="button"
              onClick={() => fetchNotifications().catch((err) => setError(getErrorMessage(err, "Impossible de rafraîchir les notifications.")))}
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-mapgeo-line bg-white px-5 py-3 text-sm font-extrabold text-mapgeo-primary shadow-soft transition hover:bg-mapgeo-ivory"
            >
              <RefreshCcw size={18} /> Rafraîchir
            </button>
            <Link
              to="/settings"
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-mapgeo-line bg-white px-5 py-3 text-sm font-extrabold text-mapgeo-primary shadow-soft transition hover:bg-mapgeo-ivory"
            >
              <Settings size={18} /> Paramètres d’alerte
            </Link>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-5 md:grid-cols-2 2xl:grid-cols-4">
          <KpiCard icon={Mail} label="Non lues" value={formatNumber(metrics.unread)} description="Sur la liste filtrée" action="Voir les non lues" onClick={() => { setActiveTab("Non lues"); setFilters({ priority: "", status: "unread", period: "", query: "" }); }} tone="blue" />
          <KpiCard icon={AlertTriangle} label={isClientPortal ? "Alertes" : "Critiques"} value={formatNumber(metrics.critical)} description="Sur la liste filtrée" action={isClientPortal ? "Voir mes alertes" : "Voir les critiques"} onClick={() => { setActiveTab("Alertes"); setFilters({ priority: "Erreur", status: "", period: "", query: "" }); }} tone="red" />
          <KpiCard icon={FileText} label="Documents" value={formatNumber(metrics.documents)} description="Sur la liste filtrée" action="Voir les documents" onClick={() => { setActiveTab("Documents"); setFilters({ priority: "", status: "", period: "", query: "" }); }} tone="purple" />
          <KpiCard icon={Headphones} label="Support" value={formatNumber(metrics.support)} description="Sur la liste filtrée" action="Voir le support" onClick={() => { setActiveTab("Support"); setFilters({ priority: "", status: "", period: "", query: "" }); }} tone="teal" />
        </section>

        <FilterTabs activeTab={activeTab} setActiveTab={setActiveTab} filters={filters} setFilters={setFilters} onReset={resetFilters} />

        <section className="grid grid-cols-1 gap-6 2xl:grid-cols-[minmax(0,1fr)_380px]">
          <NotificationsFeed
              groups={groupedNotifications}
              loading={loading}
              error={error}
              selectedIds={selectedIds}
              onToggleSelected={toggleSelectedNotification}
              onToggleVisibleSelection={toggleVisibleSelection}
              onDeleteSelected={handleDeleteSelected}
              onDeleteNotification={handleDeleteNotification}
              onMarkAsRead={handleMarkAsRead}
              onOpenNotification={handleOpenNotification}
              onReset={resetFilters}
            />
          <AlertsSummary metrics={metrics} priorityStats={priorityStats} user={user} isClientPortal={isClientPortal} onMarkAllRead={handleMarkAllRead} onOpenCritical={() => { setActiveTab("Alertes"); setFilters({ priority: "Erreur", status: "", period: "", query: "" }); }} />
        </section>
      </div>
    </DashboardLayout>
  );
}
