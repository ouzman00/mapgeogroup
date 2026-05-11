# Corrections appliquées

## Frontend cartographique

- Le panneau d’édition sur la carte est maintenant strictement dédié à la géométrie.
- Les champs descriptifs de parcelle (référence, statut, commune, localisation, notes) ont été retirés de ce panneau pour éviter une sauvegarde partielle ou trompeuse.
- Ces informations restent modifiables via le panneau `Modifier la fiche`, ce qui sépare clairement l’édition administrative de l’édition SIG.
- Le payload d’édition géométrique n’envoie plus `geometry_updated_at`, qui est read-only côté backend. Il envoie uniquement `expected_geometry_updated_at`, comme attendu pour le contrôle de conflit.
- Le formulaire `Modifier la fiche` ne renvoie plus la géométrie ni les champs calculés SIG pendant une mise à jour descriptive. Cela évite les conflits `geometry_updated_at` et les recalculs involontaires de surface/périmètre.
- Les fichiers parasites de sauvegarde et le fichier vide `XXOQZkCA` ont été retirés.

## Vérification

- `npm ci --no-audit --no-fund` exécuté avec succès.
- `npm run build` exécuté avec succès.

## Backend

- Le backend confirme que les géométries et le `bbox` cartographique sont attendus en EPSG:32628.
- Aucun changement backend n’a été appliqué dans cette correction, car le contrat API est cohérent avec la correction frontend.

## Page `/parcels`

- Le filtre client envoie désormais un paramètre métier `client` au lieu de supposer que la valeur sélectionnée est toujours un `owner_client_code`.
- Le lien vers la vue cartographique conserve maintenant les filtres actifs (`client`, `commune`, `status`, `q`).
- L’import CSV n’oblige plus systématiquement à choisir un propriétaire par défaut : un CSV contenant ses colonnes client/organisation peut être envoyé au backend.
- Le résultat d’import affiche maintenant les créations, mises à jour, erreurs partielles ou échecs au lieu d’annoncer toujours un succès.
