import LoginForm from "../components/forms/LoginForm";
import AuthLayout from "../layouts/AuthLayout";

export default function LoginPage() {
  return (
    <AuthLayout>
      <div className="rounded-3xl border border-mapgeo-line bg-white p-6 shadow-panel sm:p-8 md:p-10">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-3xl border border-mapgeo-line bg-mapgeo-ivory/60 shadow-soft">
            <img src="/logo.svg" alt="MAPGEO" className="h-10 w-auto" />
          </div>

          <p className="text-xs font-extrabold uppercase tracking-[0.24em] text-mapgeo-secondary/60">
            Connexion sécurisée
          </p>

          <h1 className="mt-3 text-3xl font-extrabold leading-tight tracking-tight text-mapgeo-primary md:text-4xl">
            Portail client & back-office MAPGEO
          </h1>

          <p className="mt-3 leading-7 text-mapgeo-secondary/70">
            Une entrée unique, des accès séparés : chaque client consulte uniquement ses parcelles,
            tandis que l’équipe interne pilote les dossiers métier.
          </p>
        </div>

        <LoginForm />

        <div className="mt-6 rounded-3xl border border-mapgeo-line bg-mapgeo-ivory/50 p-4 text-sm leading-6 text-mapgeo-secondary/80">
          <span className="font-extrabold text-mapgeo-primary">Sécurité intégrée :</span>{" "}
          les données restent filtrées par propriétaire, rôle et portail dès l’authentification.
        </div>
      </div>
    </AuthLayout>
  );
}
