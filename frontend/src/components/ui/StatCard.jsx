import { premium } from "./designSystem";

export default function StatCard({ title, value, subtitle, trend }) {
  return (
    <article className={`${premium.card} ${premium.cardPadding} overflow-hidden`}>
      <div className="flex items-start justify-between gap-5">
        <div className="min-w-0">
          <p className={premium.eyebrow}>{title}</p>
          <h3 className="mt-4 text-4xl font-extrabold tracking-[-0.04em] text-mapgeo-primary">{value}</h3>
          {subtitle ? <p className="mt-2 text-sm leading-6 text-mapgeo-secondary/68">{subtitle}</p> : null}
        </div>
        <span className="h-12 w-1 rounded-full bg-mapgeo-sand/70" aria-hidden="true" />
      </div>
      {trend ? (
        <div className="mt-6 inline-flex rounded-full border border-mapgeo-sand/35 bg-mapgeo-ivory/70 px-3.5 py-1.5 text-xs font-extrabold uppercase tracking-[0.12em] text-mapgeo-primary">
          {trend}
        </div>
      ) : null}
    </article>
  );
}
