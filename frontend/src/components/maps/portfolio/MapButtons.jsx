export function ToggleButton({ active, disabled = false, icon: Icon, label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      title={label}
      className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition ${
        disabled
          ? "cursor-not-allowed border-white/10 bg-white/5 text-white/30"
          : active
            ? "border-mapgeo-sand bg-mapgeo-sand text-mapgeo-primary shadow-sm"
            : "border-white/10 bg-white/5 text-white hover:bg-white/10"
      }`}
    >
      <Icon size={15} /> <span>{label}</span>
    </button>
  );
}

export function MapTabButton({ active, label, icon: Icon, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition ${
        active ? "bg-mapgeo-primary text-white" : "border border-mapgeo-line bg-white text-mapgeo-primary hover:bg-mapgeo-ivory"
      }`}
    >
      <Icon size={15} /> {label}
    </button>
  );
}
