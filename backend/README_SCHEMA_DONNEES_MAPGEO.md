# MapGeo — configuration cohérente PostgreSQL/PostGIS

Objectif retenu : **une seule base de travail**, sans SQLite.

- Base : `mapgeo_db`
- Utilisateur : `mapgeo`
- Mot de passe local : `mapgeo`
- Schéma métier unique : `donnees_mapgeo`
- Tables SIG principales :
  - `donnees_mapgeo.communes`
  - `donnees_mapgeo.parcels_parcel`
  - `donnees_mapgeo.parcels_parcel_qgis`
- Projection métier : `EPSG:32628`

## 1. Préparer la base et le schéma

À lancer depuis le dossier `Backend` avec l'utilisateur PostgreSQL `postgres` :

```powershell
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -h 127.0.0.1 -p 5432 -d mapgeo_db -f scripts\setup_schema_donnees_mapgeo.sql
```

Si la base `mapgeo_db` n'existe pas encore :

```powershell
& "C:\Program Files\PostgreSQL\18\bin\createdb.exe" -U postgres -h 127.0.0.1 -p 5432 mapgeo_db
```

Puis relancer le script de préparation.

## 2. Variables d'environnement locales

PowerShell :

```powershell
$env:DATABASE_URL="postgis://mapgeo:mapgeo@127.0.0.1:5432/mapgeo_db"
$env:USE_POSTGIS="True"
$env:DB_SCHEMA="donnees_mapgeo"
```

Le fichier `.env.local.example` contient les mêmes valeurs. SQLite est désactivé dans `config/settings.py` pour éviter de créer une deuxième base par accident.

## 3. Déplacer les anciennes tables `public` vers `donnees_mapgeo`

Si des tables MapGeo existent déjà dans `public`, lance ce script avec `postgres` :

```powershell
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -h 127.0.0.1 -p 5432 -d mapgeo_db -f scripts\move_public_mapgeo_tables_to_donnees_mapgeo.sql
```

Ce script :

- ne déplace pas `spatial_ref_sys` ;
- change le propriétaire des tables déplacées en `mapgeo` ;
- recrée la vue `donnees_mapgeo.parcels_parcel_qgis` ;
- remet les droits sur les tables et séquences.

## 4. Réparer la table communes si elle existait déjà

Si une ancienne table `communes` existe mais n'a pas les colonnes `code`, `nom`, `department`, `region` ou un `geom` propre en `EPSG:32628` :

```powershell
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -h 127.0.0.1 -p 5432 -d mapgeo_db -f scripts\repair_communes_table.sql
```

La migration `parcels.0011_communes_and_qgis_schema` est aussi idempotente et répare cette structure sans supprimer les lignes.

## 5. Migrations Django

```powershell
python manage.py setup_mapgeo_schema
python manage.py migrate
```

Évite `python manage.py shell` pour les commandes SQL : SQL se lance avec `psql` ou pgAdmin.

## 6. Inspection globale

Commande recommandée après chaque correction :

```powershell
python manage.py inspect_mapgeo
```

Elle vérifie :

- le moteur PostgreSQL/PostGIS ;
- le schéma `donnees_mapgeo` ;
- l'absence de tables métier restées dans `public` ;
- les tables `communes` et `parcels_parcel` ;
- les géométries et les SRID ;
- la vue QGIS ;
- les migrations ;
- la présence éventuelle d'un fichier SQLite local.

## 7. Vérifications SQL rapides

```powershell
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U mapgeo -h 127.0.0.1 -p 5432 -d mapgeo_db -c "SELECT COUNT(*) FROM donnees_mapgeo.communes;"
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U mapgeo -h 127.0.0.1 -p 5432 -d mapgeo_db -c "SELECT COUNT(*) FROM donnees_mapgeo.parcels_parcel;"
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U mapgeo -h 127.0.0.1 -p 5432 -d mapgeo_db -c "SELECT COUNT(*) FROM donnees_mapgeo.parcels_parcel WHERE geom IS NOT NULL;"
```

## 8. Connexion QGIS

Dans QGIS → PostgreSQL → nouvelle connexion :

```text
Hôte : 127.0.0.1
Port : 5432
Base : mapgeo_db
Utilisateur : mapgeo
Mot de passe : mapgeo
Schéma : donnees_mapgeo
```

Couches à charger :

- `donnees_mapgeo.communes`
- `donnees_mapgeo.parcels_parcel`
- `donnees_mapgeo.parcels_parcel_qgis`

## 9. Frontend local

Dans le frontend, l'API est appelée via `/api` et Vite proxifie vers `http://127.0.0.1:8000`.

```powershell
cd ..\frontend
npm install
npm run dev
```

Backend :

```powershell
cd ..\Backend
python manage.py runserver 127.0.0.1:8000
```
