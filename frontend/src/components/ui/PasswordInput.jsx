import { Eye, EyeOff, LockKeyhole } from "lucide-react";
import { useState } from "react";

/**
 * Champ mot de passe avec bouton afficher/masquer.
 *
 * Props :
 *   name, value, onChange, placeholder, disabled, required
 *   label          – libellé affiché au-dessus (optionnel)
 *   variant        – "light" (défaut) | "dark" (panneaux cartographiques)
 *   className      – classes supplémentaires sur le wrapper
 *   inputClassName – classes supplémentaires sur l'<input>
 */
export default function PasswordInput({
  name,
  value,
  onChange,
  placeholder = "••••••••",
  disabled = false,
  required = false,
  label,
  variant = "light",
  className = "",
  inputClassName = "",
  autoComplete = "current-password",
}) {
  const [visible, setVisible] = useState(false);

  const dark = variant === "dark";

  const wrapperClass = dark
    ? `flex h-11 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.06] px-3 transition focus-within:border-mapgeo-sand/50 focus-within:bg-white/[0.09] ${className}`
    : `flex h-10 items-center gap-2 rounded-2xl border border-mapgeo-line bg-white px-3 shadow-sm transition focus-within:border-mapgeo-primary/40 focus-within:ring-4 focus-within:ring-mapgeo-primary/5 ${className}`;

  const inputClass = dark
    ? `min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/30 disabled:opacity-40 ${inputClassName}`
    : `min-w-0 flex-1 border-0 bg-transparent p-0 text-sm text-mapgeo-primary outline-none placeholder:text-mapgeo-secondary/40 disabled:text-mapgeo-secondary/50 ${inputClassName}`;

  const iconClass = dark ? "shrink-0 text-white/40" : "shrink-0 text-mapgeo-secondary/50";
  const toggleClass = dark
    ? "ml-1 shrink-0 text-white/40 transition hover:text-white/70 focus:outline-none"
    : "ml-1 shrink-0 text-mapgeo-secondary/50 transition hover:text-mapgeo-primary focus:outline-none";

  return (
    <label className="block">
      {label ? (
        <span className={dark ? "mb-1.5 block text-[11px] font-bold uppercase tracking-[0.12em] text-white/40" : "text-xs font-bold text-mapgeo-primary/80"}>
          {label}
        </span>
      ) : null}
      <div className={label ? `mt-2 ${wrapperClass}` : wrapperClass}>
        <LockKeyhole size={16} className={iconClass} aria-hidden="true" />
        <input
          type={visible ? "text" : "password"}
          name={name}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          disabled={disabled}
          required={required}
          autoComplete={autoComplete}
          className={inputClass}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Masquer le mot de passe" : "Afficher le mot de passe"}
          className={toggleClass}
          tabIndex={-1}
        >
          {visible ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
    </label>
  );
}
