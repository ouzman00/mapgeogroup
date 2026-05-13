import { useState } from "react";
import { Download, Eye, FileBadge2 } from "lucide-react";
import documentService from "../../services/documentService";
import { getErrorMessage } from "../../services/responseUtils";
import { premium } from "./designSystem";
import { formatDateLabel } from "../../utils/dateUtils";

export default function DocumentCard({ document: doc, onDelete, deleting = false, canManage = false }) {
  const [fileAction, setFileAction] = useState(null);
  const [feedback, setFeedback] = useState("");

  const openBlob = async ({ download = false } = {}) => {
    if (!doc.id) {
      setFeedback("Aucun fichier sécurisé disponible pour ce document.");
      return;
    }

    setFileAction(download ? "download" : "preview");
    setFeedback("");

    try {
      const blob = download ? await documentService.downloadDocument(doc.id) : await documentService.previewDocument(doc.id);
      const blobUrl = URL.createObjectURL(blob);

      if (download) {
        const link = globalThis.document.createElement("a");
        link.href = blobUrl;
        link.download = doc.file_name || doc.title || "document";
        globalThis.document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(blobUrl);
        setFeedback("Téléchargement sécurisé lancé.");
        return;
      }

      window.open(blobUrl, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
      setFeedback("Aperçu sécurisé ouvert dans un nouvel onglet.");
    } catch (error) {
      setFeedback(getErrorMessage(error, download ? "Téléchargement sécurisé impossible." : "Aperçu sécurisé impossible."));
    } finally {
      setFileAction(null);
    }
  };

  const handlePreview = () => openBlob({ download: false });
  const handleDownload = () => openBlob({ download: true });

  return (
    <article className={`${premium.card} flex flex-col gap-5 p-5 lg:flex-row lg:items-center lg:justify-between`}>
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-mapgeo-sand/30 bg-mapgeo-ivory/70 text-mapgeo-primary">
          <FileBadge2 size={22} />
        </div>

        <div className="min-w-0">
          <h4 className="text-lg font-extrabold tracking-tight text-mapgeo-primary">{doc.title}</h4>
          <p className="mt-1 text-sm font-semibold text-mapgeo-secondary/75">{doc.parcel_reference || doc.parcel || "Sans parcelle"}</p>
          <p className="mt-1 text-sm text-mapgeo-secondary/55">
            Version {doc.version || "v1"} · {doc.status || "—"} · {" "}
{formatDateLabel(doc.created_at || doc.date, "Date inconnue", { day: "numeric", month: "long", year: "numeric" })}
          </p>

          {doc.description ? <p className="mt-2 max-w-3xl text-sm leading-6 text-mapgeo-secondary/70">{doc.description}</p> : null}
          {feedback ? <p className="mt-2 text-xs font-semibold text-mapgeo-primary">{feedback}</p> : null}
        </div>
      </div>

      <div className="flex flex-wrap gap-3 lg:justify-end">
        <button type="button" onClick={handlePreview} disabled={Boolean(fileAction)} className={premium.buttonSecondary}>
          <Eye size={16} />
          {fileAction === "preview" ? "Ouverture…" : "Aperçu sécurisé"}
        </button>

        <button type="button" onClick={handleDownload} disabled={Boolean(fileAction)} className={premium.buttonPrimary}>
          <Download size={16} />
          {fileAction === "download" ? "Téléchargement…" : "Téléchargement sécurisé"}
        </button>

        {canManage ? (
          <button type="button" onClick={onDelete} disabled={deleting || Boolean(fileAction)} className={premium.buttonSecondary}>
            {deleting ? "Suppression…" : "Supprimer"}
          </button>
        ) : null}
      </div>
    </article>
  );
}
