export default function ParcelDocumentsPanel({ documents }) {
  return (
    <div className="space-y-3">
      {!documents.length ? <div className="rounded-3xl border border-mapgeo-line bg-mapgeo-ivory/60 p-5 text-sm text-mapgeo-secondary">Aucun document lié à cette parcelle.</div> : null}
      {documents.map((doc) => (
        <div key={doc.id || `${doc.title}-${doc.parcel_reference}`} className="rounded-3xl border border-mapgeo-line bg-white p-5 shadow-soft">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h4 className="font-bold text-mapgeo-primary">{doc.title}</h4>
              <p className="text-sm text-mapgeo-secondary/70 mt-1">{doc.document_type || "Document"} · {doc.version || "v1"}</p>
            </div>
            {doc.file_url || doc.file ? (
              <a className="rounded-2xl bg-mapgeo-primary px-4 py-2 text-sm font-semibold text-white" href={doc.file_url || doc.file} target="_blank" rel="noreferrer">
                Ouvrir
              </a>
            ) : null}
          </div>
          {doc.description ? <p className="mt-3 text-sm text-mapgeo-secondary/80">{doc.description}</p> : null}
        </div>
      ))}
    </div>
  );
}
