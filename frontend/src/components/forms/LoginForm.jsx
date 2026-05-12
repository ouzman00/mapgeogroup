import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import useAuth from "../../hooks/useAuth";
import { getErrorMessage } from "../../services/responseUtils";
import { premium } from "../ui/designSystem";
import PasswordInput from "../ui/PasswordInput";

const inputClass = premium.input;

function getGoogleClientId() {
  const runtimeConfig = typeof window !== "undefined" ? window.__MAPGEO_CONFIG__ || {} : {};
  return runtimeConfig.GOOGLE_CLIENT_ID || import.meta.env.VITE_GOOGLE_CLIENT_ID || "";
}

function loadGoogleIdentityScript() {
  if (typeof window === "undefined") return Promise.reject(new Error("Navigateur indisponible"));
  if (window.google?.accounts?.id) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const existingScript = document.querySelector("script[data-mapgeo-google-identity]");
    if (existingScript) {
      existingScript.addEventListener("load", resolve, { once: true });
      existingScript.addEventListener("error", reject, { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.dataset.mapgeoGoogleIdentity = "true";
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

export default function LoginForm() {
  const navigate = useNavigate();
  const { login, loginWithGoogle } = useAuth();
  const [formData, setFormData] = useState({ login: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const googleButtonRef = useRef(null);
  const googleClientId = getGoogleClientId();

  const redirectAfterLogin = (response) => {
    const portalType = response?.user?.portal_type;
    navigate(portalType === "client" ? "/client/dashboard" : "/backoffice/dashboard", {
      replace: true,
    });
  };

  useEffect(() => {
    if (!googleClientId || !googleButtonRef.current) return;

    let cancelled = false;

    loadGoogleIdentityScript()
      .then(() => {
        if (cancelled || !window.google?.accounts?.id || !googleButtonRef.current) return;

        googleButtonRef.current.innerHTML = "";

        window.google.accounts.id.initialize({
          client_id: googleClientId,
          callback: async ({ credential }) => {
            if (!credential) return;

            setError("");
            setLoading(true);

            try {
              const response = await loginWithGoogle(credential);
              redirectAfterLogin(response);
            } catch (googleError) {
              setError(getErrorMessage(googleError, "Connexion Google impossible pour ce compte."));
            } finally {
              setLoading(false);
            }
          },
        });

        const buttonWidth = Math.max(260, googleButtonRef.current.offsetWidth || 320);
        window.google.accounts.id.renderButton(googleButtonRef.current, {
          theme: "outline",
          size: "large",
          width: buttonWidth,
          text: "signin_with",
          locale: "fr",
        });
      })
      .catch(() => {
        if (!cancelled) {
          setError("Le bouton Google n’a pas pu être initialisé.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [googleClientId, loginWithGoogle]);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");

    const credentials = {
      login: formData.login.trim(),
      password: formData.password,
    };

    if (!credentials.login || !credentials.password) {
      setError("Renseignez votre identifiant et votre mot de passe.");
      return;
    }

    setLoading(true);

    try {
      const response = await login(credentials);
      redirectAfterLogin(response);
    } catch (loginError) {
      setError(getErrorMessage(loginError, "Connexion impossible. Utilisez votre identifiant client, email ou nom d’utilisateur."));
    } finally {
      setLoading(false);
    }
  };

  const canSubmit = Boolean(formData.login.trim() && formData.password);

  return (
    <form className="space-y-5" onSubmit={handleSubmit} noValidate>
      <div>
        <label className="mb-2 block text-sm font-bold text-mapgeo-primary">Identifiant client, email ou nom d’utilisateur</label>
        <input
          name="login"
          type="text"
          value={formData.login}
          onChange={handleChange}
          placeholder="Ex : CLT-0001"
          className={inputClass}
          autoComplete="username"
          required
        />
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between gap-3">
          <label className="block text-sm font-bold text-mapgeo-primary">Mot de passe</label>
          <Link to="/forgot-password" className="text-xs font-extrabold text-mapgeo-primary underline-offset-4 hover:underline">
            Mot de passe oublié ?
          </Link>
        </div>
        <PasswordInput
          name="password"
          value={formData.password}
          onChange={handleChange}
          placeholder="••••••••"
          required
          autoComplete="current-password"
        />
      </div>

      {error ? (
        <div className="rounded-2xl border border-mapgeo-sand/40 bg-mapgeo-sand/10 px-4 py-3 text-sm font-medium text-mapgeo-primary" role="alert">
          {error}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={loading || !canSubmit}
        className={`${premium.buttonPrimary} w-full py-3.5 disabled:opacity-60`}
      >
        {loading ? "Connexion..." : "Accéder à mon espace sécurisé"}
      </button>

      {googleClientId ? (
        <div className="space-y-3">
          <div className="flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.18em] text-mapgeo-secondary/60">
            <span className="h-px flex-1 bg-mapgeo-line" />
            ou
            <span className="h-px flex-1 bg-mapgeo-line" />
          </div>
          <div ref={googleButtonRef} className="flex min-h-[44px] justify-center" aria-label="Se connecter avec Google" />
        </div>
      ) : null}
    </form>
  );
}
