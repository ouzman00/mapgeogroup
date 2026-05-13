import { useState } from "react";
import documentService from "../../../services/documentService";
import { getErrorMessage } from "../../../services/responseUtils";

export default function ParcelDocumentsPanel({ documents }) {
  const [openingId, setOpeningId] = useState(null);
  const [message, setMessage] = useState("");

  const openDocument = async (doc) => {
    if (!doc) return;

    setMessage("");
    setOpeningId(doc.id || doc.file_url || doc.file || doc.title);

    try {
      if (doc.id) {
        const blob = await documentService.previewDocument(doc.id);
        const blobUrl = URL.createObjectURL(blob);
        window.open(blobUrl, "_blank", "noopener,noreferrer");
        window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
        return;
      }

      if (doc.file_url || doc.file) {
        window.open(doc.file_url || doc.file, "_blank", "noopener,noreferrer");
      }
    } catch (error) {
      setMessage(getErrorMessage(error, "Impossible d’ouvrir ce document."));
    } finally {
      setOpeningId(null);
    }
  };

  return (
    <div className="space-y-3">
      {message ? <div className="rounded-2xl border border-red-100 bg-red-50 p-3 text-sm font-semibold text-red-700">{message}</div> : null}
      {!documents.length ? <div className="rounded-3xl border border-mapgeo-line bg-mapgeo-ivory/60 p-5 text-sm text-mapgeo-secondary">Aucun document lié à cette parcelle.</div> : null}
      {documents.map((doc) => (
        <div key={doc.id || `${doc.title}-${doc.parcel_reference}`} className="rounded-3xl border border-mapgeo-line bg-white p-5 shadow-soft">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h4 className="font-bold text-mapgeo-primary">{doc.title}</h4>
              <p className="text-sm text-mapgeo-secondary/70 mt-1">{doc.document_type || "Document"} · {doc.version || "v1"}</p>
            </div>
            {doc.id || doc.file_url || doc.file ? (
              <button
                type="button"
                className="rounded-2xl bg-mapgeo-primary px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                onClick={() => openDocument(doc)}
                disabled={openingId === (doc.id || doc.file_url || doc.file || doc.title)}
              >
                {openingId === (doc.id || doc.file_url || doc.file || doc.title) ? "Ouverture…" : "Ouvrir"}
              </button>
            ) : null}
          </div>
          {doc.description ? <p className="mt-3 text-sm text-mapgeo-secondary/80">{doc.description}</p> : null}
        </div>
      ))}
    </div>
  );
}
