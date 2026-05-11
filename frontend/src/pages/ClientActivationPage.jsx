import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { CheckCircle2, KeyRound } from "lucide-react";
import AuthLayout from "../layouts/AuthLayout";
import { confirmClientActivation, validateClientActivation } from "../services/clientService";
import { getErrorMessage } from "../services/responseUtils";

export default function ClientActivationPage() {
  const { uid, token } = useParams();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [profile, setProfile] = useState(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    password: "",
    password_confirm: "",
  });

  useEffect(() => {
    let active = true;

    setLoading(true);
    setError("");

    validateClientActivation(uid, token)
      .then((data) => {
        if (active) setProfile(data);
      })
      .catch((requestError) => {
        if (active) {
          setError(getErrorMessage(requestError, "Lien d’activation invalide ou expiré."));
        }
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
      await confirmClientActivation({
        uid,
        token,
        password: form.password,
        password_confirm: form.password_confirm,
      });

      setMessage("Compte activé. Redirection vers la connexion...");
      window.setTimeout(() => navigate("/login", { replace: true }), 1200);
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Activation impossible."));
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
            <p className="text-xs font-extrabold uppercase tracking-[0.22em] text-mapgeo-secondary/60">Espace client</p>
            <h1 className="mt-2 text-2xl font-extrabold text-mapgeo-primary">
              Activation de votre espace client
            </h1>
            <p className="mt-2 text-sm leading-6 text-mapgeo-secondary/75">
              Définissez votre mot de passe sécurisé pour accéder à votre portail MAPGEO.
            </p>
          </div>
        </div>

        {loading ? (
          <p className="mt-6 text-sm text-mapgeo-secondary">Vérification du lien...</p>
        ) : null}

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
              {profile.client_code ? (
                <span>
                  {" "}
                  · Code client :{" "}
                  <strong className="text-mapgeo-primary">{profile.client_code}</strong>
                </span>
              ) : null}
            </div>

            <label className="block">
              <span className="text-xs font-bold text-mapgeo-primary">
                Nouveau mot de passe
              </span>
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
              <span className="text-xs font-bold text-mapgeo-primary">
                Confirmer le mot de passe
              </span>
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
              <CheckCircle2 size={18} /> {saving ? "Activation..." : "Activer mon compte"}
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
