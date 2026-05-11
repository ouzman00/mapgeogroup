export default function ProgressBar({ value = 0, label = "Avancement" }) {
  const safeValue = Math.max(0, Math.min(100, Number(value) || 0));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs font-extrabold uppercase tracking-[0.14em] text-mapgeo-secondary/60">
        <span>{label}</span>
        <span className="text-mapgeo-primary">{safeValue}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-mapgeo-ivory ring-1 ring-mapgeo-sand/25">
        <div
          className="h-full rounded-full bg-gradient-to-r from-mapgeo-secondary to-mapgeo-sand transition-all duration-500"
          style={{ width: `${safeValue}%` }}
        />
      </div>
    </div>
  );
}
