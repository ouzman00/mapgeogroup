export default function SearchNoResultNotice({ searchTerm, onClearSearch }) {
  const value = searchTerm?.trim();
  if (!value) return null;

  return (
    <div className="absolute bottom-20 left-4 z-[1000] max-w-[calc(100%-2rem)] rounded-2xl border border-mapgeo-sand/35 bg-[#07111b]/92 px-4 py-3 text-sm text-white shadow-panel backdrop-blur">
      <p className="font-bold text-mapgeo-ivory">Aucune parcelle ne correspond à “{value}”.</p>
      <p className="mt-1 text-xs leading-5 text-white/60">La carte masque les parcelles pendant cette recherche pour éviter toute confusion.</p>
      {onClearSearch ? (
        <button type="button" onClick={onClearSearch} className="mt-2 rounded-xl border border-white/10 bg-white/[0.045] px-3 py-2 text-xs font-extrabold text-white/75 hover:bg-white/10">
          Réinitialiser la recherche
        </button>
      ) : null}
    </div>
  );
}
