# MageoSIG / MapGeo — stabilisation production minimale

Ce document décrit les réglages externes nécessaires après les corrections de code. Il ne contient aucun secret réel.

## Architecture validée

- Frontend Vercel : `https://mapgeogroup.vercel.app`
- Backend Render : `https://mapgeogroup.onrender.com`
- API appelée directement par le frontend : `https://mapgeogroup.onrender.com/api`
- Pas de rewrite Vercel `/api` nécessaire.
- PostgreSQL/PostGIS Render avec schéma métier `donnees_mapgeo`.

## Variables Render à vérifier

```env
DJANGO_ENV=production
DJANGO_DEBUG=False
DJANGO_SECRET_KEY=<secret-long-aleatoire-apres-rotation>
DJANGO_ALLOWED_HOSTS=mapgeogroup.onrender.com
DJANGO_TIME_ZONE=Africa/Dakar

DATABASE_URL=<database-url-render-apres-rotation>
DB_SCHEMA=donnees_mapgeo
DB_CONN_MAX_AGE=60

DJANGO_CORS_ALLOW_ALL_ORIGINS=False
DJANGO_CORS_ALLOW_CREDENTIALS=True
DJANGO_CORS_ALLOWED_ORIGINS=https://mapgeogroup.vercel.app
DJANGO_CSRF_TRUSTED_ORIGINS=https://mapgeogroup.vercel.app
FRONTEND_URL=https://mapgeogroup.vercel.app

JWT_REFRESH_COOKIE_ENABLED=True
JWT_REFRESH_COOKIE_BODY_ENABLED=False
JWT_REFRESH_COOKIE_NAME=mapgeo_refresh
JWT_REFRESH_COOKIE_PATH=/api/auth/refresh/
JWT_REFRESH_COOKIE_SAMESITE=None
JWT_REFRESH_COOKIE_SECURE=True
JWT_REFRESH_COOKIE_HTTPONLY=True

DJANGO_SESSION_COOKIE_SAMESITE=None
DJANGO_CSRF_COOKIE_SAMESITE=None
DJANGO_SECURE_PROXY_SSL_HEADER=True
DJANGO_SECURE_SSL_REDIRECT=False
DJANGO_SECURE_HSTS_SECONDS=31536000
DJANGO_SECURE_HSTS_INCLUDE_SUBDOMAINS=True
DJANGO_SECURE_HSTS_PRELOAD=True

REDIS_URL=<redis-url-render>

MEDIA_ROOT=/mnt/render-disk/media
PRIVATE_MEDIA_ROOT=/mnt/render-disk/private_media
PRIVATE_GEOJSON_ROOT=/mnt/render-disk/private_geojson
PRIVATE_MAP_LAYERS_ROOT=/mnt/render-disk/private_map_layers

EXTERNAL_MAP_PROXY_ALLOWED_HOSTS=<hotes-wms-wfs-autorises>
EXTERNAL_MAP_PROXY_MAX_BYTES=20971520

DEFAULT_FROM_EMAIL=<adresse-email-expediteur>
EMAIL_BACKEND=django.core.mail.backends.smtp.EmailBackend
EMAIL_HOST=<smtp-host>
EMAIL_PORT=587
EMAIL_HOST_USER=<smtp-user>
EMAIL_HOST_PASSWORD=<smtp-password>
EMAIL_USE_TLS=True
```

## Variables Vercel à vérifier

Le fichier `frontend/public/runtime-config.js` est la source runtime principale. Garder aussi les variables suivantes cohérentes si elles sont définies dans Vercel :

```env
VITE_API_BASE_URL=https://mapgeogroup.onrender.com/api
VITE_USE_REFRESH_COOKIE=true
VITE_ACCESS_TOKEN_STORAGE=memory
VITE_GOOGLE_CLIENT_ID=<si-google-oauth-est-utilise>
```

Configuration Vercel attendue :

```text
Root directory: frontend
Install command: pnpm install --frozen-lockfile
Build command: pnpm run build
Output directory: dist
```

## Actions secrets obligatoires

1. Régénérer le mot de passe PostgreSQL Render si `DATABASE_URL` a été exposée.
2. Remplacer `DATABASE_URL` dans Render.
3. Redéployer le backend.
4. Régénérer `DJANGO_SECRET_KEY` si elle a pu être exposée.
5. Régénérer les secrets SMTP/OAuth exposés éventuels.
6. Ne jamais afficher les secrets dans les logs, issues, captures ou tickets.

Impact de rotation `DJANGO_SECRET_KEY` : les tokens signés, sessions, liens d'activation/reset et cookies existants peuvent devenir invalides. C'est acceptable avant production.

## Commandes de contrôle

```bash
git status
git pull --ff-only origin main
```

Frontend :

```bash
cd frontend
corepack enable
pnpm install --frozen-lockfile
pnpm run build
pnpm run test
```

Backend local Linux/Codespaces :

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt
python manage.py check
python manage.py check --deploy
python manage.py makemigrations --check --dry-run
python manage.py migrate
python manage.py collectstatic --noinput
python manage.py test
```

Backend Windows : si GeoDjango/GDAL bloque, utiliser WSL ou Codespaces.

Render Shell :

```bash
python manage.py check --deploy
python manage.py showmigrations
python manage.py migrate --noinput
python manage.py collectstatic --noinput
python manage.py createsuperuser
```

Healthcheck :

```bash
curl -i https://mapgeogroup.onrender.com/api/health/
```

Login GET attendu en 405 :

```bash
curl -i https://mapgeogroup.onrender.com/api/accounts/login/
```

Login POST :

```bash
curl -i -c cookies.txt -X POST https://mapgeogroup.onrender.com/api/accounts/login/ \
  -H "Content-Type: application/json" \
  -d '{"login":"mapgeo","password":"<MOT_DE_PASSE>"}'
```

Refresh cookie :

```bash
curl -i -b cookies.txt -X POST https://mapgeogroup.onrender.com/api/auth/refresh/ \
  -H "Content-Type: application/json" \
  -d '{}'
```

CORS preflight :

```bash
curl -i -X OPTIONS https://mapgeogroup.onrender.com/api/accounts/login/ \
  -H "Origin: https://mapgeogroup.vercel.app" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type"
```

## SQL PostgreSQL/PostGIS

```sql
SELECT version();
SELECT PostGIS_full_version();
SHOW search_path;

SELECT schemaname, tablename
FROM pg_tables
WHERE schemaname IN ('public', 'donnees_mapgeo')
ORDER BY schemaname, tablename;

SELECT f_table_schema, f_table_name, f_geometry_column, srid, type
FROM geometry_columns
ORDER BY 1, 2, 3;
```

## Sauvegarde PostgreSQL

```bash
pg_dump "$DATABASE_URL" \
  --format=custom \
  --no-owner \
  --no-acl \
  --file="mapgeo_full_$(date +%Y%m%d_%H%M).dump"
```

## Restauration PostgreSQL

Attention : peut écraser des données.

```bash
pg_restore \
  --clean \
  --if-exists \
  --no-owner \
  --no-acl \
  --dbname "$DATABASE_URL" \
  mapgeo_full_YYYYMMDD_HHMM.dump

python manage.py migrate --noinput
python manage.py check
```

## Checklist avant production

- [ ] Secrets Render/Vercel rotés.
- [ ] `DATABASE_URL` régénérée.
- [ ] `DJANGO_SECRET_KEY` régénérée si doute.
- [ ] `JWT_REFRESH_COOKIE_SAMESITE=None`, `Secure=True`, `HttpOnly=True`.
- [ ] CORS/CSRF limités à `https://mapgeogroup.vercel.app`.
- [ ] Persistent Disk Render monté.
- [ ] Fichiers privés sous `/mnt/render-disk`.
- [ ] Redis configuré.
- [ ] SMTP configuré.
- [ ] Backup DB créé.
- [ ] Restauration testée hors production.
- [ ] Tests login/refresh/reload frontend réussis.
- [ ] Tests inter-organisations réussis.
- [ ] Tests uploads/imports réussis.
- [ ] Logs Render sans erreur.
- [ ] Build Vercel pnpm réussi.

## Verdict après ces corrections

Tant que les secrets ne sont pas rotés et que Render n'a pas Persistent Disk + Redis + SMTP vérifiés, le projet reste `préproduction non validée` et `no-go production`.
