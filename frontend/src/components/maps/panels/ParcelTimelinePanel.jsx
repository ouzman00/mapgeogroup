export default function ParcelTimelinePanel({ timeline }) {
  return (
    <div className="space-y-3">
      {!timeline.length ? <div className="rounded-3xl border border-mapgeo-line bg-mapgeo-ivory/60 p-5 text-sm text-mapgeo-secondary">Aucun jalon disponible.</div> : null}
      {timeline.map((event) => (
        <div key={event.id} className="rounded-3xl border border-mapgeo-line bg-white p-5 shadow-soft">
          <div className="flex items-center justify-between gap-3">
            <h4 className="font-bold text-mapgeo-primary">{event.title}</h4>
            {event.progress !== null && event.progress !== undefined ? (
              <span className="rounded-full border border-mapgeo-line px-3 py-1 text-xs font-semibold text-mapgeo-primary">{event.progress}%</span>
            ) : null}
          </div>
          <p className="mt-2 text-sm text-mapgeo-secondary/80">{event.description || "Pas de détail fourni."}</p>
          <p className="mt-3 text-xs text-mapgeo-secondary/60">{event.date ? new Date(event.date).toLocaleDateString("fr-FR") : "Date non renseignée"}</p>
        </div>
      ))}
    </div>
  );
}
