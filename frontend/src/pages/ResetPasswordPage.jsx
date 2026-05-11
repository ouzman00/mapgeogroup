import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { CheckCircle2, KeyRound } from "lucide-react";
import AuthLayout from "../layouts/AuthLayout";
import authService from "../services/authService";
import { getErrorMessage } from "../services/responseUtils";

export default function ResetPasswordPage() {
  const { uid, token } = useParams();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [profile, setProfile] = useState(null);
  const [form, setForm] = useState({ password: "", password_confirm: "" });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    setLoading(true);
    setError("");

    authService.validateResetPassword(uid, token)
      .then((data) => {
        if (active) setProfile(data);
      })
      .catch((requestError) => {
        if (active) setError(getErrorMessage(requestError, "Lien de réinitialisation invalide ou expiré."));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [uid, token]);

  const update = (name, value) => {
    setForm((current) => ({ ...current, [name]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    setError("");
    setMessage("");

    if (!form.password || !form.password_confirm) {
      setError("Renseignez et confirmez votre nouveau mot de passe.");
      return;
    }

    if (form.password !== form.password_confirm) {
      setError("Les mots de passe ne correspondent pas.");
      return;
    }

    setSaving(true);

    try {
      await authService.resetPassword({
        uid,
        token,
        password: form.password,
        password_confirm: form.password_confirm,
      });

      setMessage("Mot de passe réinitialisé. Redirection vers la connexion...");
      window.setTimeout(() => navigate("/login", { replace: true }), 1200);
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Réinitialisation impossible."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <AuthLayout>
      <section className="rounded-3xl border border-mapgeo-line bg-white p-6 shadow-panel sm:p-8">
        <div className="flex items-start gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-mapgeo-sand/15 text-mapgeo-primary">
            <KeyRound size={24} />
          </div>
          <div>
            <p className="text-xs font-extrabold uppercase tracking-[0.22em] text-mapgeo-secondary/60">Nouveau mot de passe</p>
            <h1 className="mt-2 text-2xl font-extrabold text-mapgeo-primary">Réinitialisation du mot de passe</h1>
            <p className="mt-2 text-sm leading-6 text-mapgeo-secondary/75">
              Définissez un nouveau mot de passe sécurisé pour votre compte MAPGEO.
            </p>
          </div>
        </div>

        {loading ? <p className="mt-6 text-sm text-mapgeo-secondary">Vérification du lien...</p> : null}

        {!loading && error ? (
          <div className="mt-6 rounded-2xl border border-mapgeo-sand/40 bg-mapgeo-sand/10 p-4 text-sm font-medium text-mapgeo-primary">
            {error}
          </div>
        ) : null}

        {!loading && profile && !message ? (
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div className="rounded-2xl bg-mapgeo-ivory px-4 py-3 text-sm text-mapgeo-secondary">
              Compte :{" "}
              <strong className="text-mapgeo-primary">
                {profile.display_name || profile.email || profile.username}
              </strong>
            </div>

            <label className="block">
              <span className="text-xs font-bold text-mapgeo-primary">Nouveau mot de passe</span>
              <input
                type="password"
                value={form.password}
                onChange={(event) => update("password", event.target.value)}
                className="mt-2 w-full rounded-2xl border border-mapgeo-line px-4 py-3 text-sm outline-none focus:border-mapgeo-primary"
                autoComplete="new-password"
                required
              />
            </label>

            <label className="block">
              <span className="text-xs font-bold text-mapgeo-primary">Confirmer le mot de passe</span>
              <input
                type="password"
                value={form.password_confirm}
                onChange={(event) => update("password_confirm", event.target.value)}
                className="mt-2 w-full rounded-2xl border border-mapgeo-line px-4 py-3 text-sm outline-none focus:border-mapgeo-primary"
                autoComplete="new-password"
                required
              />
            </label>

            <button
              type="submit"
              disabled={saving || !form.password || !form.password_confirm}
              className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-mapgeo-primary px-5 py-3 text-sm font-extrabold text-white shadow-panel disabled:opacity-60"
            >
              <CheckCircle2 size={18} /> {saving ? "Réinitialisation..." : "Réinitialiser mon mot de passe"}
            </button>
          </form>
        ) : null}

        {message ? (
          <div className="mt-6 rounded-2xl border border-mapgeo-line bg-mapgeo-primary/6 p-4 text-sm font-medium text-mapgeo-primary">
            {message}
          </div>
        ) : null}

        <Link to="/login" className="mt-5 inline-flex text-sm font-bold text-mapgeo-primary">
          Retour à la connexion
        </Link>
      </section>
    </AuthLayout>
  );
}
