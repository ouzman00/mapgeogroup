import { useState } from "react";
import { Link } from "react-router-dom";
import { Mail, Send } from "lucide-react";
import AuthLayout from "../layouts/AuthLayout";
import authService from "../services/authService";
import { getErrorMessage } from "../services/responseUtils";

export default function ForgotPasswordPage() {
  const [identifier, setIdentifier] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = async (event) => {
    event.preventDefault();

    const normalizedIdentifier = identifier.trim();

    setMessage("");
    setError("");

    if (!normalizedIdentifier) {
      setError("Renseignez votre e-mail, nom d’utilisateur ou identifiant client.");
      return;
    }

    setSaving(true);

    try {
      const response = await authService.forgotPassword({ identifier: normalizedIdentifier });
      setMessage(response?.detail || "Si un compte actif correspond à cet identifiant, un e-mail de réinitialisation vient d’être envoyé.");
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Impossible de traiter la demande de réinitialisation."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <AuthLayout>
      <section className="rounded-3xl border border-mapgeo-line bg-white p-6 shadow-panel sm:p-8">
        <div className="flex items-start gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-mapgeo-sand/15 text-mapgeo-primary">
            <Mail size={24} />
          </div>
          <div>
            <p className="text-xs font-extrabold uppercase tracking-[0.22em] text-mapgeo-secondary/60">Sécurité compte</p>
            <h1 className="mt-2 text-2xl font-extrabold text-mapgeo-primary">Mot de passe oublié ?</h1>
            <p className="mt-2 text-sm leading-6 text-mapgeo-secondary/75">
              Saisissez votre e-mail, nom d’utilisateur ou identifiant client. Si un compte actif correspond, un lien temporaire de réinitialisation sera envoyé.
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <label className="block">
            <span className="text-xs font-bold text-mapgeo-primary">Email, nom d’utilisateur ou identifiant client</span>
            <input
              type="text"
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
              className="mt-2 w-full rounded-2xl border border-mapgeo-line px-4 py-3 text-sm outline-none focus:border-mapgeo-primary"
              autoComplete="username"
              required
            />
          </label>

          {message ? (
            <div className="rounded-2xl border border-mapgeo-line bg-mapgeo-primary/6 p-4 text-sm font-medium text-mapgeo-primary">
              {message}
            </div>
          ) : null}

          {error ? (
            <div className="rounded-2xl border border-mapgeo-sand/40 bg-mapgeo-sand/10 p-4 text-sm font-medium text-mapgeo-primary">
              {error}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={saving || !identifier.trim()}
            className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-mapgeo-primary px-5 py-3 text-sm font-extrabold text-white shadow-panel disabled:opacity-60"
          >
            <Send size={17} /> {saving ? "Envoi..." : "Envoyer le lien de réinitialisation"}
          </button>
        </form>

        <Link to="/login" className="mt-5 inline-flex text-sm font-bold text-mapgeo-primary">
          Retour à la connexion
        </Link>
      </section>
    </AuthLayout>
  );
}
