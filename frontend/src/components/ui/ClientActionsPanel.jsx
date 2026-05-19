import { CheckCircle2, Clock3, FileText, MapPin, AlertCircle } from "lucide-react";

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function actionIcon(type) {
  switch (type) {
    case "document":
      return FileText;
    case "appointment":
      return Clock3;
    case "validation":
      return CheckCircle2;
    default:
      return AlertCircle;
  }
}

export default function ClientActionsPanel({
  actions = [],
  loading = false,
  error = "",
  title = "Actions attendues",
  emptyLabel = "Aucune action attendue pour le moment.",
  onComplete,
}) {
  return (
    <section className="rounded-3xl border border-mapgeo-line bg-white p-5 shadow-soft">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-xl font-extrabold text-mapgeo-primary">{title}</h3>
          <p className="mt-1 text-sm leading-6 text-mapgeo-secondary/70">
            Retrouvez ici les éléments attendus pour faire avancer votre dossier.
          </p>
        </div>
        {actions.length ? (
          <span className="rounded-full bg-mapgeo-sand/15 px-3 py-1 text-xs font-extrabold text-mapgeo-primary">
            {actions.length}
          </span>
        ) : null}
      </div>

      {loading ? (
        <p className="mt-4 rounded-2xl border border-mapgeo-line bg-mapgeo-ivory/60 px-4 py-3 text-sm font-semibold text-mapgeo-secondary">
          Chargement des actions attendues…
        </p>
      ) : null}

      {error ? (
        <p className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
          {error}
        </p>
      ) : null}

      {!loading && !error && !actions.length ? (
        <p className="mt-4 rounded-2xl border border-mapgeo-line bg-mapgeo-ivory/60 px-4 py-3 text-sm font-semibold text-mapgeo-secondary">
          {emptyLabel}
        </p>
      ) : null}

      {actions.length ? (
        <div className="mt-4 space-y-3">
          {actions.map((item) => {
            const Icon = actionIcon(item.action_type);
            const dueDate = formatDate(item.due_date);

            return (
              <article key={item.id} className="rounded-2xl border border-mapgeo-line bg-mapgeo-ivory/50 p-4">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-mapgeo-primary/10 text-mapgeo-primary">
                    <Icon size={17} />
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                      <h4 className="font-extrabold text-mapgeo-primary">{item.title}</h4>
                      {dueDate ? (
                        <span className="shrink-0 rounded-full border border-mapgeo-sand/30 bg-mapgeo-sand/10 px-2.5 py-1 text-[11px] font-bold text-mapgeo-primary">
                          Échéance {dueDate}
                        </span>
                      ) : null}
                    </div>

                    {item.description ? (
                      <p className="mt-2 text-sm leading-6 text-mapgeo-secondary/75">{item.description}</p>
                    ) : null}

                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-semibold text-mapgeo-secondary/70">
                      {item.parcel_reference ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1">
                          <MapPin size={13} /> {item.parcel_reference}
                        </span>
                      ) : null}
                      <span className="inline-flex rounded-full bg-white px-2.5 py-1">
                        {item.action_type_label || "Action"}
                      </span>
                    </div>
                  </div>
                </div>

                {onComplete && item.status === "open" ? (
                  <div className="mt-3 flex justify-end">
                    <button
                      type="button"
                      onClick={() => onComplete(item)}
                      className="inline-flex items-center gap-2 rounded-xl border border-mapgeo-primary/20 bg-white px-3 py-2 text-xs font-extrabold text-mapgeo-primary transition hover:bg-mapgeo-primary hover:text-white"
                    >
                      <CheckCircle2 size={14} /> Marquer comme terminé
                    </button>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
