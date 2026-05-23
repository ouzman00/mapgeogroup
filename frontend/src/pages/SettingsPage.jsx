import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BellRing,
  Building2,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Globe2,
  History,
  KeyRound,
  Laptop,
  LockKeyhole,
  Mail,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  UserRound,
  X,
} from "lucide-react";
import DashboardLayout from "../layouts/DashboardLayout";
import useAuth from "../hooks/useAuth";
import authService from "../services/authService";
import { getErrorMessage } from "../services/responseUtils";
import { ROLE_LABELS, getRoleLabel as getSharedRoleLabel } from "../constants/roleConstants";
import PasswordInput from "../components/ui/PasswordInput";

const STORAGE_KEY_PREFERENCES = "mapgeo_preferences";
const STORAGE_KEY_AVATARS = "mapgeo_profile_avatars";

const DEFAULT_PROFILE = {
  first_name: "",
  last_name: "",
  email: "",
  phone: "",
  company_name: "",
};

const DEFAULT_PASSWORD = {
  current_password: "",
  new_password: "",
  confirm_password: "",
};

const DEFAULT_PREFERENCES = {
  documentAlerts: true,
  supportAlerts: true,
  blockedParcelAlerts: true,
  emailFrequency: "daily",
  language: "fr",
  dateFormat: "dd/mm/yyyy",
  displayMode: "comfortable",
};

const BASE_SETTINGS_NAV = [
  { id: "profile", label: "Profil", icon: UserRound },
  { id: "security", label: "Sécurité", icon: ShieldCheck },
  { id: "notifications", label: "Notifications", icon: BellRing },
  { id: "preferences", label: "Préférences locales", icon: SlidersHorizontal },
];

const INTERNAL_SETTINGS_NAV = [
  { id: "profile", label: "Profil", icon: UserRound },
  { id: "security", label: "Sécurité", icon: ShieldCheck },
  { id: "notifications", label: "Notifications", icon: BellRing },
  { id: "organization", label: "Organisation", icon: Building2 },
  { id: "preferences", label: "Préférences locales", icon: SlidersHorizontal },
];

function loadStoredPreferences() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_PREFERENCES);
    if (!stored) return DEFAULT_PREFERENCES;

    return {
      ...DEFAULT_PREFERENCES,
      ...JSON.parse(stored),
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

function getDisplayName(user) {
  const fullName = [user?.first_name, user?.last_name].filter(Boolean).join(" ").trim();
  return fullName || user?.company_name || user?.username || user?.email || "Utilisateur";
}

function getInitial(user) {
  return getDisplayName(user).charAt(0).toUpperCase() || "U";
}

function getAvatarStorageKey(user) {
  return String(user?.id || user?.username || user?.email || "current-user");
}

function loadStoredAvatar(user) {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY_AVATARS);
    if (!stored) return "";
    const avatars = JSON.parse(stored);
    return avatars?.[getAvatarStorageKey(user)] || "";
  } catch {
    return "";
  }
}

function saveStoredAvatar(user, avatarDataUrl) {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY_AVATARS);
    const avatars = stored ? JSON.parse(stored) : {};
    const key = getAvatarStorageKey(user);

    if (avatarDataUrl) avatars[key] = avatarDataUrl;
    else delete avatars[key];

    window.localStorage.setItem(STORAGE_KEY_AVATARS, JSON.stringify(avatars));
    return true;
  } catch {
    return false;
  }
}

function getPortalLabel(user) {
  if (user?.portal_type === "client" || user?.role === "client") return "Client";
  return "Interne";
}

function getRoleLabel(user) {
  return getSharedRoleLabel(user?.role || user) || "Utilisateur";
}

function calculateProfileCompletion(profileForm) {
  const fields = [
    profileForm.first_name,
    profileForm.last_name,
    profileForm.email,
    profileForm.phone,
    profileForm.company_name,
  ];

  const filled = fields.filter((field) => String(field || "").trim()).length;
  return Math.max(20, Math.round((filled / fields.length) * 100));
}

function getPrimaryOrganization(user) {
  const organizations = Array.isArray(user?.organizations) ? user.organizations : [];
  return organizations.find((item) => item.is_primary) || organizations[0] || null;
}

function normalizeProfilePayload(profileForm) {
  return {
    first_name: String(profileForm.first_name || "").trim(),
    last_name: String(profileForm.last_name || "").trim(),
    email: String(profileForm.email || "").trim().toLowerCase(),
    phone: String(profileForm.phone || "").trim(),
    company_name: String(profileForm.company_name || "").trim(),
  };
}

function persistStoredUser(profile) {
  try {
    window.sessionStorage.setItem("mapgeo_user", JSON.stringify(profile));
    window.localStorage.removeItem("mapgeo_user");
  } catch {
    // Le contexte Auth garde tout de même le profil à jour en mémoire.
  }
}

function saveStoredPreferences(preferences) {
  try {
    window.localStorage.setItem(STORAGE_KEY_PREFERENCES, JSON.stringify(preferences));
    return true;
  } catch {
    return false;
  }
}

function SettingsNav({ activeSection, onNavigateSection, items }) {
  return (
    <aside className="rounded-3xl border border-mapgeo-line bg-white p-3 shadow-soft lg:h-full lg:w-56 lg:shrink-0 lg:overflow-hidden">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-1">
        {items.map((item) => {
          const Icon = item.icon;
          const active = activeSection === item.id;

          return (
            <button
              key={item.id}
              type="button"
              onClick={(event) => {
                event.preventDefault();
                onNavigateSection(item.id);
              }}
              aria-current={active ? "page" : undefined}
              className={`flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm font-extrabold transition ${
                active
                  ? "bg-mapgeo-sand/15 text-mapgeo-primary shadow-sm"
                  : "text-mapgeo-primary hover:bg-mapgeo-ivory"
              }`}
            >
              <Icon size={19} />
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}

function TextInput({
  label,
  name,
  value,
  onChange,
  type = "text",
  placeholder,
  disabled = false,
  icon: Icon,
}) {
  return (
    <label className="block">
      <span className="text-xs font-bold text-mapgeo-primary/80">{label}</span>
      <div className="mt-2 flex h-10 items-center gap-2 rounded-2xl border border-mapgeo-line bg-white px-3 shadow-sm transition focus-within:border-mapgeo-primary/40 focus-within:ring-4 focus-within:ring-mapgeo-primary/5">
        {Icon ? <Icon size={16} className="text-mapgeo-secondary/60" /> : null}

        <input
          type={type}
          name={name}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          disabled={disabled}
          className="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm text-mapgeo-primary outline-none placeholder:text-mapgeo-secondary/40 disabled:text-mapgeo-secondary/50"
        />
      </div>
    </label>
  );
}

function SelectInput({ label, value, onChange, children, disabled = false }) {
  return (
    <label className="block">
      <span className="text-xs font-bold text-mapgeo-primary/80">{label}</span>

      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        className="mt-2 h-10 w-full rounded-2xl border border-mapgeo-line bg-white px-3 text-sm text-mapgeo-primary outline-none transition focus:border-mapgeo-primary/40 focus:ring-4 focus:ring-mapgeo-primary/5 disabled:bg-mapgeo-ivory disabled:text-mapgeo-secondary/60"
      >
        {children}
      </select>
    </label>
  );
}

function ToggleRow({ label, description, checked, onChange }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-4 rounded-2xl border border-mapgeo-line bg-white px-4 py-3 text-left transition hover:bg-mapgeo-ivory/60"
    >
      <span>
        <span className="block text-sm font-bold text-mapgeo-primary">{label}</span>
        {description ? (
          <span className="mt-0.5 block text-xs text-mapgeo-secondary/70">
            {description}
          </span>
        ) : null}
      </span>

      <span
        className={`relative h-6 w-11 shrink-0 rounded-full transition ${
          checked ? "bg-mapgeo-primary" : "bg-mapgeo-sand/45"
        }`}
      >
        <span
          className={`absolute top-1 h-4 w-4 rounded-full bg-white transition ${
            checked ? "left-6" : "left-1"
          }`}
        />
      </span>
    </button>
  );
}

function SegmentedControl({ label, options, value, onChange }) {
  return (
    <div>
      <span className="text-xs font-bold text-mapgeo-primary/80">{label}</span>

      <div className="mt-2 grid grid-cols-2 rounded-2xl border border-mapgeo-line bg-white p-1">
        {options.map((option) => {
          const active = value === option.value;

          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange(option.value)}
              className={`inline-flex h-8 items-center justify-center gap-2 rounded-xl text-sm font-bold transition ${
                active
                  ? "bg-mapgeo-sand/15 text-mapgeo-primary ring-1 ring-mapgeo-sand"
                  : "text-mapgeo-secondary hover:bg-mapgeo-ivory"
              }`}
            >
              {active ? <CheckCircle2 size={15} /> : null}
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SectionBlock({ id, title, children }) {
  return (
    <section
      id={id}
      data-settings-section="true"
      className="border-b border-mapgeo-line px-5 py-4 last:border-b-0 last:pb-8 sm:px-6"
    >
      <h3 className="text-lg font-extrabold text-mapgeo-primary">{title}</h3>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function ProfileSection({
  profileForm,
  onProfileChange,
  user,
  avatarPreview,
  onAvatarChange,
  onAvatarRemove,
}) {
  return (
    <SectionBlock id="profile" title="1. Profil utilisateur">
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_210px]">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <TextInput
            label="Prénom"
            name="first_name"
            value={profileForm.first_name}
            onChange={onProfileChange}
            placeholder="Votre prénom"
          />

          <TextInput
            label="Nom"
            name="last_name"
            value={profileForm.last_name}
            onChange={onProfileChange}
            placeholder="Votre nom"
          />

          <TextInput
            label="Email"
            name="email"
            value={profileForm.email}
            onChange={onProfileChange}
            placeholder="votre@email.com"
            icon={Mail}
          />

          <TextInput
            label="Téléphone"
            name="phone"
            value={profileForm.phone}
            onChange={onProfileChange}
            placeholder="+221 ..."
          />

          <div className="md:col-span-2">
            <TextInput
              label="Société"
              name="company_name"
              value={profileForm.company_name}
              onChange={onProfileChange}
              placeholder="Nom de votre société"
              icon={Building2}
            />
          </div>
        </div>

        <div className="rounded-3xl border border-mapgeo-line bg-mapgeo-ivory/30 p-4 text-center">
          <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-mapgeo-secondary/70">
            Photo de profil
          </p>

          <div className="mx-auto mt-3 flex h-20 w-20 items-center justify-center overflow-hidden rounded-full bg-mapgeo-primary text-4xl font-extrabold text-white shadow-panel">
            {avatarPreview ? (
              <img
                src={avatarPreview}
                alt="Aperçu avatar"
                className="h-full w-full object-cover"
              />
            ) : (
              getInitial(user)
            )}
          </div>

          <div className="mt-4 space-y-2">
            <label className="inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-2xl bg-mapgeo-primary px-4 py-2.5 text-sm font-extrabold text-white shadow-soft transition hover:bg-mapgeo-primary/95">
              <UserRound size={16} /> Choisir une photo
              <input
                type="file"
                accept="image/*"
                capture={undefined}
                className="sr-only"
                onChange={onAvatarChange}
              />
            </label>

            {avatarPreview ? (
              <button
                type="button"
                onClick={onAvatarRemove}
                className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-mapgeo-line bg-white px-4 py-2.5 text-sm font-bold text-mapgeo-primary transition hover:bg-mapgeo-ivory"
              >
                <X size={16} /> Supprimer la photo
              </button>
            ) : null}
          </div>

          <p className="mt-3 text-xs leading-5 text-mapgeo-secondary/60">
            Photo enregistrée localement sur ce navigateur. Le profil backend reste inchangé tant qu’aucun endpoint avatar n’est disponible.
          </p>
        </div>
      </div>
    </SectionBlock>
  );
}

function SecuritySection({
  passwordForm,
  onPasswordChange,
  onPasswordSubmit,
  savingPassword,
  passwordMessage,
  sessionMessage,
}) {
  return (
    <SectionBlock id="security" title="2. Sécurité du compte">
      <form onSubmit={onPasswordSubmit} className="space-y-3">
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
          <PasswordInput
            label="Mot de passe actuel (obligatoire)"
            name="current_password"
            value={passwordForm.current_password}
            onChange={onPasswordChange}
            placeholder="••••••••••"
            autoComplete="current-password"
          />

          <PasswordInput
            label="Nouveau mot de passe"
            name="new_password"
            value={passwordForm.new_password}
            onChange={onPasswordChange}
            placeholder="••••••••••"
            autoComplete="new-password"
          />

          <PasswordInput
            label="Confirmer le mot de passe"
            name="confirm_password"
            value={passwordForm.confirm_password}
            onChange={onPasswordChange}
            placeholder="••••••••••"
            autoComplete="new-password"
          />
        </div>

        <div className="flex flex-col gap-3 rounded-2xl border border-mapgeo-line bg-mapgeo-ivory/30 p-3 lg:flex-row lg:items-center lg:justify-between">
          <p className="inline-flex items-center gap-2 text-sm font-medium text-mapgeo-secondary">
            <Clock3 size={17} /> Sécurité du compte
          </p>

          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="submit"
              disabled={savingPassword}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-mapgeo-primary px-4 py-2.5 text-sm font-extrabold text-white shadow-soft transition hover:bg-mapgeo-primary/95 disabled:opacity-60"
            >
              <KeyRound size={17} />
              {savingPassword ? "Traitement en cours…" : "Changer le mot de passe"}
            </button>
          </div>
        </div>

        {passwordMessage ? <Message>{passwordMessage}</Message> : null}
        {sessionMessage ? <Message>{sessionMessage}</Message> : null}
      </form>
    </SectionBlock>
  );
}

function NotificationsSection({ preferences, setPreference, isClientPortal }) {
  return (
    <SectionBlock id="notifications" title="3. Notifications">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-2">
          <ToggleRow
            label="Recevoir les alertes documents"
            description={isClientPortal ? "Nouveaux documents disponibles sur vos parcelles." : "Versions, validations et documents à rattacher. Préférence locale à ce navigateur."}
            checked={preferences.documentAlerts}
            onChange={(value) => setPreference("documentAlerts", value)}
          />

          <ToggleRow
            label="Recevoir les alertes support"
            description={isClientPortal ? "Réponses et mises à jour de vos demandes." : "Tickets, réponses et demandes critiques. Préférence locale à ce navigateur."}
            checked={preferences.supportAlerts}
            onChange={(value) => setPreference("supportAlerts", value)}
          />

          <ToggleRow
            label={isClientPortal ? "Recevoir les alertes parcelles" : "Recevoir les alertes parcelles bloquées"}
            description={isClientPortal ? "Avancement et changements liés à vos parcelles." : "Blocages et vérifications en retard. Préférence locale à ce navigateur."}
            checked={preferences.blockedParcelAlerts}
            onChange={(value) => setPreference("blockedParcelAlerts", value)}
          />
        </div>

        <SelectInput
          label="Fréquence des emails"
          value={preferences.emailFrequency}
          onChange={(value) => setPreference("emailFrequency", value)}
        >
          <option value="realtime">En temps réel</option>
          <option value="daily">Quotidienne</option>
          <option value="weekly">Hebdomadaire</option>
          <option value="never">Désactivée</option>
        </SelectInput>
      </div>
    </SectionBlock>
  );
}

function OrganizationSection({ profileForm, user, isClientPortal }) {
  const organization = getPrimaryOrganization(user);

  if (isClientPortal) {
    return (
      <SectionBlock id="organization" title="Organisation">
        <div className="rounded-2xl border border-mapgeo-line bg-mapgeo-ivory/30 p-4">
          <p className="text-sm font-bold text-mapgeo-primary">
            {organization?.name || profileForm.company_name || "Organisation non renseignée"}
          </p>

          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
            <InfoBox label="Code client" value={organization?.code || user?.client_code || "—"} />
            <InfoBox label="Type d’espace" value="Portail client" />
          </div>
        </div>
      </SectionBlock>
    );
  }

  return (
    <SectionBlock id="organization" title="4. Organisation et rattachement">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <TextInput
          label="Nom société"
          value={profileForm.company_name || organization?.name || ""}
          onChange={() => {}}
          disabled
        />

        <SelectInput
          label="Type de portail"
          value={user?.portal_type || "internal"}
          onChange={() => {}}
          disabled
        >
          <option value="internal">Interne</option>
          <option value="client">Client</option>
        </SelectInput>

        <SelectInput
          label="Rôle utilisateur"
          value={user?.role || ""}
          onChange={() => {}}
          disabled
        >
          <option value="">Non renseigné</option>
          {Object.entries(ROLE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </SelectInput>

        <TextInput
          label="Identifiant client"
          value={user?.client_code || "Non applicable"}
          onChange={() => {}}
          disabled
        />
      </div>
    </SectionBlock>
  );
}

function InfoBox({ label, value }) {
  return (
    <div className="rounded-2xl border border-mapgeo-line bg-white px-4 py-3">
      <p className="text-xs font-bold uppercase tracking-[0.14em] text-mapgeo-secondary/60">{label}</p>
      <p className="mt-1 text-sm font-extrabold text-mapgeo-primary">{value}</p>
    </div>
  );
}

function PreferencesSection({ preferences, setPreference, sectionIndex = 4 }) {
  return (
    <SectionBlock id="preferences" title={`${sectionIndex}. Préférences locales`}>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <SelectInput
          label="Langue"
          value={preferences.language}
          onChange={(value) => setPreference("language", value)}
        >
          <option value="fr">Français</option>
          <option value="en">Anglais</option>
        </SelectInput>

        <SelectInput
          label="Format de date"
          value={preferences.dateFormat}
          onChange={(value) => setPreference("dateFormat", value)}
        >
          <option value="dd/mm/yyyy">JJ/MM/AAAA</option>
          <option value="yyyy-mm-dd">AAAA-MM-JJ</option>
          <option value="mm/dd/yyyy">MM/JJ/AAAA</option>
        </SelectInput>

        <SegmentedControl
          label="Affichage"
          value={preferences.displayMode}
          onChange={(value) => setPreference("displayMode", value)}
          options={[
            { value: "compact", label: "Compact" },
            { value: "comfortable", label: "Confortable" },
          ]}
        />
      </div>
    </SectionBlock>
  );
}

function AccountSummary({ user, profileCompletion, preferences, onNavigateSection, isClientPortal }) {
  const activeNotifications = [
    preferences.documentAlerts,
    preferences.supportAlerts,
    preferences.blockedParcelAlerts,
  ].filter(Boolean).length;

  return (
    <aside className="relative overflow-visible rounded-3xl bg-hero p-6 text-white shadow-panel lg:h-full lg:overflow-hidden">
      <div className="absolute -right-16 -top-16 h-44 w-44 rounded-full bg-white/[0.06] blur-3xl" />

      <div className="relative">
        <h3 className="text-xl font-extrabold text-white">Résumé du compte</h3>

        <div className="mt-6 space-y-4 border-b border-white/10 pb-5">
          <SummaryMetric
            icon={CheckCircle2}
            label="Profil complété"
            value={`${profileCompletion}%`}
            highlight
          />
          <SummaryMetric icon={UserRound} label="Rôle" value={getRoleLabel(user)} />
          <SummaryMetric icon={Building2} label="Portail" value={getPortalLabel(user)} />
          <SummaryMetric
            icon={BellRing}
            label="Notifications activées"
            value={activeNotifications}
          />
        </div>

        <div className="mt-5 border-b border-white/10 pb-5">
          <h4 className="text-sm font-extrabold text-white">Sécurité</h4>
          <div className="mt-3 space-y-3">
            <SummaryMetric icon={ShieldCheck} label="Authentification standard" value="" />
            <SummaryMetric icon={Laptop} label="Sessions de connexion" value="" />
            <SummaryMetric icon={LockKeyhole} label="Changement sécurisé" value="" />
          </div>
        </div>

        <div className="mt-5 border-b border-white/10 pb-5">
          <h4 className="text-sm font-extrabold text-white">Actions rapides</h4>
          <div className="mt-3 space-y-2">
            <QuickAction
              icon={KeyRound}
              label="Changer le mot de passe"
              sectionId="security"
              onNavigateSection={onNavigateSection}
            />
            <QuickAction
              icon={BellRing}
              label="Gérer les notifications"
              sectionId="notifications"
              onNavigateSection={onNavigateSection}
            />
            {!isClientPortal ? (
              <QuickAction
                icon={History}
                label="Contrôler la sécurité du compte"
                sectionId="security"
                onNavigateSection={onNavigateSection}
              />
            ) : null}
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-white/10 p-4">
            <Globe2 size={22} className="text-white/75" />
            <p className="mt-3 text-xs uppercase tracking-[0.14em] text-white/50">
              Portail
            </p>
            <p className="font-extrabold">{getPortalLabel(user)}</p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/10 p-4">
            <ShieldCheck size={22} className="text-white/75" />
            <p className="mt-3 text-xs uppercase tracking-[0.14em] text-white/50">
              Rôle
            </p>
            <p className="font-extrabold">{getRoleLabel(user)}</p>
          </div>
        </div>
      </div>
    </aside>
  );
}

function SummaryMetric({ icon: Icon, label, value, highlight = false }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <Icon size={18} className={highlight ? "text-mapgeo-sand" : "text-white/70"} />
      <span className="flex-1 text-white/80">{label}</span>
      {value !== "" ? <span className="font-extrabold text-white">{value}</span> : null}
    </div>
  );
}

function QuickAction({ icon: Icon, label, sectionId, onNavigateSection }) {
  return (
    <button
      type="button"
      onClick={() => onNavigateSection(sectionId)}
      className="flex w-full items-center gap-3 rounded-2xl py-2 text-left text-sm font-semibold text-white/90 transition hover:bg-white/5"
    >
      <Icon size={17} className="text-white/70" />
      <span className="flex-1">{label}</span>
      <ChevronRight size={16} className="text-white/60" />
    </button>
  );
}

function Message({ children }) {
  const text = String(children).toLowerCase();
  const isError = text.includes("impossible") || text.includes("correspond pas") || text.includes("renseignez") || text.includes("non disponible");

  return (
    <p
      className={`rounded-2xl border px-4 py-3 text-sm font-medium ${
        isError
          ? "border-mapgeo-sand/40 bg-mapgeo-sand/10 text-mapgeo-primary"
          : "border-mapgeo-line bg-mapgeo-primary/6 text-mapgeo-primary"
      }`}
    >
      {children}
    </p>
  );
}

export default function SettingsPage() {
  const { user, setUser, isClientPortal } = useAuth();
  const sectionsScrollRef = useRef(null);
  const isProgrammaticScrollRef = useRef(false);
  const programmaticScrollTimeoutRef = useRef(null);

  const navItems = isClientPortal ? BASE_SETTINGS_NAV : INTERNAL_SETTINGS_NAV;

  const [activeSection, setActiveSection] = useState("profile");
  const [profileForm, setProfileForm] = useState(DEFAULT_PROFILE);
  const [initialProfileForm, setInitialProfileForm] = useState(DEFAULT_PROFILE);
  const [passwordForm, setPasswordForm] = useState(DEFAULT_PASSWORD);
  const [preferences, setPreferences] = useState(() => loadStoredPreferences());
  const [initialPreferences, setInitialPreferences] = useState(() => loadStoredPreferences());
  const [profileMessage, setProfileMessage] = useState("");
  const [passwordMessage, setPasswordMessage] = useState("");
  const [sessionMessage, setSessionMessage] = useState("");
  const [avatarPreview, setAvatarPreview] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  useEffect(() => {
    if (!user) return;

    const nextProfile = {
      first_name: user.first_name || "",
      last_name: user.last_name || "",
      email: user.email || "",
      phone: user.phone || "",
      company_name: user.company_name || getPrimaryOrganization(user)?.name || "",
    };

    setProfileForm(nextProfile);
    setInitialProfileForm(nextProfile);
    const stored = loadStoredAvatar(user);
    if (stored) setAvatarPreview(stored);
  }, [user]);

  useEffect(() => {
    if (isClientPortal && activeSection === "organization") {
      setActiveSection("profile");
    }
  }, [isClientPortal, activeSection]);

  useEffect(() => {
    return () => {
      if (programmaticScrollTimeoutRef.current) {
        window.clearTimeout(programmaticScrollTimeoutRef.current);
      }
    };
  }, []);

  const profileCompletion = useMemo(
    () => calculateProfileCompletion(profileForm),
    [profileForm],
  );

  const handleNavigateSection = useCallback((sectionId) => {
    const scrollContainer = sectionsScrollRef.current;
    const section = document.getElementById(sectionId);

    if (!scrollContainer || !section) return;

    setActiveSection(sectionId);
    isProgrammaticScrollRef.current = true;

    const containerTop = scrollContainer.getBoundingClientRect().top;
    const sectionTop = section.getBoundingClientRect().top;
    const nextScrollTop = scrollContainer.scrollTop + sectionTop - containerTop - 8;

    scrollContainer.scrollTo({
      top: Math.max(nextScrollTop, 0),
      behavior: "smooth",
    });

    if (programmaticScrollTimeoutRef.current) {
      window.clearTimeout(programmaticScrollTimeoutRef.current);
    }

    programmaticScrollTimeoutRef.current = window.setTimeout(() => {
      isProgrammaticScrollRef.current = false;
    }, 520);
  }, []);

  useEffect(() => {
    const scrollContainer = sectionsScrollRef.current;
    const sections = navItems.map((item) => document.getElementById(item.id)).filter(Boolean);

    if (!scrollContainer || !sections.length || typeof IntersectionObserver === "undefined") {
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (isProgrammaticScrollRef.current) return;

        const visibleEntry = entries
          .filter((entry) => entry.isIntersecting)
          .sort((first, second) => {
            const containerTop = scrollContainer.getBoundingClientRect().top;
            const firstTop = Math.abs(first.boundingClientRect.top - containerTop);
            const secondTop = Math.abs(second.boundingClientRect.top - containerTop);
            return firstTop - secondTop;
          })[0];

        if (visibleEntry?.target?.id) {
          setActiveSection(visibleEntry.target.id);
        }
      },
      {
        root: scrollContainer,
        rootMargin: "-8px 0px -58% 0px",
        threshold: [0.08, 0.18, 0.34],
      },
    );

    sections.forEach((section) => observer.observe(section));

    return () => observer.disconnect();
  }, [navItems]);

  const handleProfileChange = (event) => {
    const { name, value } = event.target;
    setProfileForm((current) => ({ ...current, [name]: value }));
  };

  const handlePasswordChange = (event) => {
    const { name, value } = event.target;
    setPasswordForm((current) => ({ ...current, [name]: value }));
  };

  const handleAvatarChange = (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setProfileMessage("Choisissez un fichier image valide.");
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      setProfileMessage("La photo doit peser moins de 2 Mo.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      setAvatarPreview(dataUrl);
      const saved = saveStoredAvatar(user, dataUrl);
      setProfileMessage(saved ? "Photo de profil mise à jour localement." : "Photo chargée, mais impossible de l’enregistrer localement.");
    };
    reader.onerror = () => setProfileMessage("Impossible de lire cette photo.");
    reader.readAsDataURL(file);
  };

  const handleAvatarRemove = () => {
    setAvatarPreview("");
    const saved = saveStoredAvatar(user, "");
    setProfileMessage(saved ? "Photo de profil supprimée localement." : "Impossible de supprimer la photo locale.");
  };

  const setPreference = (name, value) => {
    setPreferences((current) => ({ ...current, [name]: value }));
  };

  const saveProfile = async () => {
    const normalizedProfile = normalizeProfilePayload(profileForm);

    if (!normalizedProfile.email) {
      setProfileMessage("Renseignez une adresse e-mail valide avant d’enregistrer.");
      return false;
    }

    setSavingProfile(true);
    setProfileMessage("");

    try {
      const updated = await authService.updateProfile(normalizedProfile);
      const refreshedProfile = await authService.getProfile().catch(() => updated);
      setUser(refreshedProfile);
      persistStoredUser(refreshedProfile);
      setProfileForm(normalizeProfilePayload(refreshedProfile));
      setInitialProfileForm(normalizeProfilePayload(refreshedProfile));
      setProfileMessage("Profil enregistré avec succès.");
      return true;
    } catch (error) {
      console.error(error);
      setProfileMessage(getErrorMessage(error, "Impossible de mettre à jour le profil."));
      return false;
    } finally {
      setSavingProfile(false);
    }
  };

  const savePassword = async (event) => {
    event.preventDefault();
    setPasswordMessage("");

    if (!passwordForm.current_password || !passwordForm.new_password || !passwordForm.confirm_password) {
      setPasswordMessage("Renseignez le mot de passe actuel, le nouveau mot de passe et sa confirmation.");
      return;
    }

    if (passwordForm.new_password !== passwordForm.confirm_password) {
      setPasswordMessage("La confirmation du mot de passe ne correspond pas.");
      return;
    }

    if (passwordForm.current_password === passwordForm.new_password) {
      setPasswordMessage("Le nouveau mot de passe doit être différent du mot de passe actuel.");
      return;
    }

    setSavingPassword(true);

    try {
      const response = await authService.changePassword(passwordForm);
      setPasswordMessage(response.detail || "Mot de passe mis à jour.");
      setPasswordForm(DEFAULT_PASSWORD);
    } catch (error) {
      console.error(error);
      setPasswordMessage(getErrorMessage(error, "Impossible de mettre à jour le mot de passe."));
    } finally {
      setSavingPassword(false);
    }
  };

  const handleSaveAll = async () => {
    const profileSaved = await saveProfile();
    const preferencesSaved = saveStoredPreferences(preferences);

    if (preferencesSaved) {
      setInitialPreferences(preferences);
    }

    if (profileSaved && preferencesSaved) {
      setProfileMessage("Profil enregistré. Les préférences locales sont enregistrées sur ce navigateur.");
    } else if (profileSaved && !preferencesSaved) {
      setProfileMessage("Profil mis à jour, mais impossible d’enregistrer les préférences locales du navigateur.");
    }
  };

  const handleCancel = () => {
    setProfileForm(initialProfileForm);
    setPasswordForm(DEFAULT_PASSWORD);
    setPreferences(initialPreferences);
    setProfileMessage("Modifications annulées.");
    setPasswordMessage("");
    setSessionMessage("");
  };

  return (
    <DashboardLayout
      title="Paramètres"
      subtitle={
        isClientPortal
          ? "Gérez votre profil, votre mot de passe, vos notifications et vos préférences."
          : "Gérez votre profil, votre sécurité, vos préférences et les paramètres d’organisation."
      }
    >
      <div className="flex min-h-[calc(100dvh-7.25rem)] flex-col gap-4 pb-[max(1rem,env(safe-area-inset-bottom,0px))] md:h-[calc(100dvh-7.25rem)] md:min-h-[580px] md:overflow-hidden md:pb-0">
        <section className="flex shrink-0 flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <nav className="text-sm font-semibold text-mapgeo-primary" aria-label="Fil d’Ariane">
              Accueil <span className="mx-1 text-mapgeo-secondary/40">/</span> Paramètres
            </nav>

            <p className="mt-2 max-w-3xl text-sm text-mapgeo-secondary/70 lg:hidden">
              {isClientPortal
                ? "Gérez votre profil, votre mot de passe, vos notifications et vos préférences."
                : "Gérez votre profil, votre sécurité, vos préférences et les paramètres d’organisation."}
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={handleSaveAll}
              disabled={savingProfile}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-mapgeo-primary px-5 py-3 text-sm font-extrabold text-white shadow-panel transition hover:bg-mapgeo-primary disabled:opacity-60"
            >
              <Save size={18} />
              {savingProfile ? "Traitement en cours…" : "Enregistrer les modifications"}
            </button>

            <button
              type="button"
              onClick={handleCancel}
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-mapgeo-line bg-white px-5 py-3 text-sm font-extrabold text-mapgeo-primary shadow-soft transition hover:bg-mapgeo-ivory"
            >
              <X size={18} /> Annuler
            </button>
          </div>
        </section>

        {profileMessage ? (
          <div className="mb-3 shrink-0">
            <Message>{profileMessage}</Message>
          </div>
        ) : null}

        <section className="grid min-h-0 flex-1 grid-cols-1 gap-6 overflow-visible md:overflow-hidden 2xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="flex min-h-0 flex-col gap-6 overflow-visible md:overflow-hidden lg:flex-row">
            <SettingsNav
              activeSection={activeSection}
              onNavigateSection={handleNavigateSection}
              items={navItems}
            />

            <div
              ref={sectionsScrollRef}
              id="settings-sections-scroll"
              className="min-h-0 min-w-0 flex-1 overflow-visible rounded-3xl border border-mapgeo-line bg-white shadow-soft scroll-smooth md:overflow-y-auto"
            >
              <ProfileSection
                profileForm={profileForm}
                onProfileChange={handleProfileChange}
                user={user}
                avatarPreview={avatarPreview}
                onAvatarChange={handleAvatarChange}
                onAvatarRemove={handleAvatarRemove}
              />

              <SecuritySection
                passwordForm={passwordForm}
                onPasswordChange={handlePasswordChange}
                onPasswordSubmit={savePassword}
                savingPassword={savingPassword}
                passwordMessage={passwordMessage}
                sessionMessage={sessionMessage}
              />

              <NotificationsSection
                preferences={preferences}
                setPreference={setPreference}
                isClientPortal={isClientPortal}
              />

              {!isClientPortal ? (
                <OrganizationSection
                  profileForm={profileForm}
                  user={user}
                  isClientPortal={isClientPortal}
                />
              ) : null}

              <PreferencesSection
                preferences={preferences}
                setPreference={setPreference}
                sectionIndex={isClientPortal ? 4 : 5}
              />
            </div>
          </div>

          <AccountSummary
            user={user}
            profileCompletion={profileCompletion}
            preferences={preferences}
            onNavigateSection={handleNavigateSection}
            isClientPortal={isClientPortal}
          />
        </section>
      </div>
    </DashboardLayout>
  );
}
