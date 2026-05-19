import { CalendarDays, CheckCircle2, Clock3, MapPin, ShieldAlert, UserRound } from "lucide-react";

function formatDate(value) {
  if (!value) return "Date à confirmer";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date à confirmer";
  return date.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function statusTone(status) {
  if (status === "done") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "in_progress") return "border-blue-200 bg-blue-50 text-blue-700";
  if (status === "blocked") return "border-red-200 bg-red-50 text-red-700";
  if (status === "cancelled") return "border-slate-200 bg-slate-50 text-slate-600";
  return "border-mapgeo-sand/30 bg-mapgeo-sand/10 text-mapgeo-primary";
}

function statusIcon(status) {
  if (status === "done") return CheckCircle2;
  if (status === "blocked") return ShieldAlert;
  return Clock3;
}

export default function FieldInterventionsPanel({
  interventions = [],
  loading = false,
  error = "",
  title = "Interventions terrain",
  emptyLabel = "Aucune intervention terrain programmée pour cette parcelle.",
}) {
  const nextIntervention = interventions.find((item) => ["scheduled", "in_progress", "blocked"].includes(item.status));
  const history = interventions.filter((item) => item !== nextIntervention);

  return (
    <section className="rounded-3xl border border-mapgeo-line bg-white p-6 shadow-soft">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-xl font-extrabold text-mapgeo-primary">
            <MapPin size={19} /> {title}
          </h3>
          <p className="mt-2 text-sm leading-6 text-mapgeo-secondary/70">
            Suivez les passages terrain, rendez-vous et comptes rendus liés à cette parcelle.
          </p>
        </div>

        {interventions.length ? (
          <span className="rounded-full bg-mapgeo-sand/15 px-3 py-1 text-xs font-extrabold text-mapgeo-primary">
            {interventions.length}
          </span>
        ) : null}
      </div>

      {loading ? (
        <p className="mt-4 rounded-2xl border border-mapgeo-line bg-mapgeo-ivory/60 px-4 py-3 text-sm font-semibold text-mapgeo-secondary">
          Chargement des interventions terrain…
        </p>
      ) : null}

      {error ? (
        <p className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
          {error}
        </p>
      ) : null}

      {!loading && !error && !interventions.length ? (
        <p className="mt-4 rounded-2xl border border-mapgeo-line bg-mapgeo-ivory/60 px-4 py-3 text-sm font-semibold text-mapgeo-secondary">
          {emptyLabel}
        </p>
      ) : null}

      {nextIntervention ? (
        <article className="mt-5 rounded-2xl border border-mapgeo-sand/30 bg-mapgeo-sand/10 p-4">
          <p className="text-[11px] font-black uppercase tracking-[0.18em] text-mapgeo-secondary/60">
            Prochaine étape terrain
          </p>
          <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h4 className="text-lg font-extrabold text-mapgeo-primary">{nextIntervention.title || "Intervention terrain"}</h4>
              <p className="mt-1 flex items-center gap-2 text-sm font-semibold text-mapgeo-secondary">
                <CalendarDays size={15} /> {formatDate(nextIntervention.scheduled_date)}
              </p>
              {nextIntervention.agent_name ? (
                <p className="mt-1 flex items-center gap-2 text-sm font-semibold text-mapgeo-secondary">
                  <UserRound size={15} /> {nextIntervention.agent_name}
                </p>
              ) : null}
            </div>

            <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold ${statusTone(nextIntervention.status)}`}>
              {(() => {
                const Icon = statusIcon(nextIntervention.status);
                return <Icon size={14} />;
              })()}
              {nextIntervention.status_label || "Programmée"}
            </span>
          </div>

          {nextIntervention.report ? (
            <p className="mt-3 rounded-xl bg-white/70 px-3 py-2 text-sm leading-6 text-mapgeo-secondary">
              {nextIntervention.report}
            </p>
          ) : null}
        </article>
      ) : null}

      {history.length ? (
        <div className="mt-5 space-y-3">
          <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-mapgeo-secondary/60">
            Historique terrain
          </p>

          {history.map((item) => {
            const Icon = statusIcon(item.status);

            return (
              <article key={item.id} className="rounded-2xl border border-mapgeo-line bg-mapgeo-ivory/50 p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h4 className="font-extrabold text-mapgeo-primary">{item.title || "Intervention terrain"}</h4>
                    <p className="mt-1 text-sm text-mapgeo-secondary">{formatDate(item.scheduled_date)}</p>
                    {item.agent_name ? <p className="mt-1 text-sm text-mapgeo-secondary">{item.agent_name}</p> : null}
                  </div>

                  <span className={`inline-flex w-fit items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold ${statusTone(item.status)}`}>
                    <Icon size={14} /> {item.status_label || item.status}
                  </span>
                </div>

                {item.report ? (
                  <p className="mt-3 text-sm leading-6 text-mapgeo-secondary/75">{item.report}</p>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
