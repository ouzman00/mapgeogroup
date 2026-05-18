import { Component } from "react";

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    // Log local pour debug. Un service externe (Sentry) peut etre branche ici.
    console.error("ErrorBoundary capture une erreur React:", error, errorInfo);
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null });
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  };

  handleGoHome = () => {
    if (typeof window !== "undefined") {
      window.location.href = "/";
    }
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="flex min-h-dvh items-center justify-center bg-mapgeo-ivory px-4 py-8">
        <div className="w-full max-w-lg rounded-3xl border border-mapgeo-line bg-white p-6 shadow-panel">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-mapgeo-sand/20 text-2xl">
              <span aria-hidden="true">!</span>
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-xl font-extrabold text-mapgeo-primary">
                Une erreur est survenue
              </h1>
              <p className="mt-2 text-sm leading-6 text-mapgeo-secondary/75">
                L application a rencontre un probleme inattendu. Vous pouvez
                rafraichir la page ou revenir a l accueil. Si le probleme persiste,
                contactez le support.
              </p>
              {this.state.error?.message ? (
                <pre className="mt-3 max-h-32 overflow-auto rounded-xl border border-mapgeo-line bg-mapgeo-ivory/60 p-3 text-[11px] font-mono text-mapgeo-secondary/70">
                  {String(this.state.error.message)}
                </pre>
              ) : null}
            </div>
          </div>

          <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={this.handleGoHome}
              className="rounded-2xl border border-mapgeo-line bg-white px-5 py-3 text-sm font-extrabold text-mapgeo-primary transition hover:bg-mapgeo-ivory"
            >
              Retour a l accueil
            </button>
            <button
              type="button"
              onClick={this.handleReload}
              className="rounded-2xl bg-mapgeo-primary px-5 py-3 text-sm font-extrabold text-white shadow-panel transition hover:bg-mapgeo-primary/95"
            >
              Recharger la page
            </button>
          </div>
        </div>
      </div>
    );
  }
}
