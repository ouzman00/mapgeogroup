import { Loader2 } from "lucide-react";

export function LoadingInline({ label = "Chargement en cours", tone = "light" }) {
  const toneClass = tone === "dark"
    ? "border-white/10 bg-white/10 text-white"
    : "border-mapgeo-line bg-white text-mapgeo-primary";

  return (
    <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-extrabold shadow-sm ${toneClass}`}>
      <Loader2 size={14} className="animate-spin" />
      {label}
    </span>
  );
}

export default function LoadingState({
  title = "Chargement en cours",
  message = "Synchronisation des données, merci de patienter.",
  compact = false,
  dark = false,
}) {
  const wrapperClass = dark
    ? "border-white/10 bg-white/10 text-white"
    : "border-mapgeo-line bg-white text-mapgeo-primary";

  return (
    <div className={`rounded-3xl border shadow-soft ${compact ? "p-4" : "p-6"} ${wrapperClass}`}>
      <div className="flex items-center gap-4">
        <span className={`flex ${compact ? "h-10 w-10" : "h-12 w-12"} shrink-0 items-center justify-center rounded-2xl ${dark ? "bg-white/10" : "bg-mapgeo-ivory"}`}>
          <Loader2 size={compact ? 18 : 22} className="animate-spin" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-extrabold">{title}</p>
          <p className={`mt-1 text-xs leading-5 ${dark ? "text-white/70" : "text-mapgeo-secondary/70"}`}>
            {message}
          </p>
        </div>
      </div>
    </div>
  );
}

export function LoadingTableRow({
  colSpan = 1,
  title = "Chargement en cours",
  message = "Synchronisation des données, merci de patienter.",
}) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-5 py-10">
        <div className="mx-auto max-w-md">
          <LoadingState title={title} message={message} compact />
        </div>
      </td>
    </tr>
  );
}
