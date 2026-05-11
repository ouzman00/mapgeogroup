export default function AuthLayout({ children }) {
  return (
    <div className="grid min-h-dvh bg-mapgeo-ivory text-white xl:grid-cols-[minmax(0,1.15fr)_minmax(440px,0.85fr)]">
      <div className="relative hidden overflow-hidden bg-hero p-10 xl:flex xl:flex-col xl:justify-between">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(255,255,255,0.18),_transparent_36%)]" aria-hidden="true" />
        <div className="relative z-10 flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.07] shadow-soft">
            <img src="/logo.svg" alt="MAPGEO" className="h-9 w-auto" />
          </div>
          <div>
            <span className="text-2xl font-extrabold tracking-wide">MAPGEO</span>
            <p className="mt-1 text-xs uppercase tracking-[0.24em] text-white/70">Valorisation foncière</p>
          </div>
        </div>

        <div className="relative z-10 max-w-2xl py-12">
          <p className="mb-4 text-sm font-bold uppercase tracking-[0.25em] text-mapgeo-sand">Plateforme cartographique foncière</p>
          <h1 className="max-w-2xl text-5xl font-extrabold leading-[1.05] tracking-tight 2xl:text-6xl">
            Donnez à chaque parcelle une lecture claire, stratégique et patrimoniale.
          </h1>
          <p className="mt-7 max-w-xl text-lg leading-8 text-white/80">
            Cartographie, orthophoto, documents techniques, suivi d’avancement,
            indicateurs de potentiel et présentation haut de gamme du bien foncier.
          </p>
        </div>

        <div className="relative z-10 overflow-hidden rounded-3xl border border-white/10 shadow-soft">
          <img src="/drone-placeholder.svg" alt="Vue drone MAPGEO" className="h-72 w-full object-cover" />
        </div>
      </div>

      <div className="flex items-center justify-center px-4 py-8 sm:px-6 md:p-10">
        <div className="w-full max-w-lg">{children}</div>
      </div>
    </div>
  );
}
