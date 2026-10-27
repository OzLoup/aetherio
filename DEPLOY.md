# Desplegar AetherIO

Mismo esquema que `nami`: **backend en Google Cloud Run**, **frontend en Cloudflare
Pages**, **base de datos en Neon**. Costo esperado con poco tráfico: ~$0/mes (el video
nunca pasa por nuestra infraestructura).

**Ya desplegado el 2026-10-27** (direcciones y comandos de redeploy en `CLAUDE.md` → Producción).
Esta guía queda como referencia para rehacerlo desde cero.

## 1. Base de datos (Neon)
1. Crear proyecto `aetherio` en https://neon.tech (región cercana a Cloud Run, p. ej. us-east).
2. Copiar la cadena de conexión y pasarla a formato SQLAlchemy:
   `postgresql+psycopg://USUARIO:CLAVE@HOST/aetherio?sslmode=require`
3. (Opcional) Pasar los datos locales: `pg_dump` del Postgres local → `psql` contra Neon.
   Requiere la **misma** `DATA_ENCRYPTION_KEY` que la base local, o las URLs de addons no se
   podrán leer.

## 2. Secretos
Generar una vez y guardar en Google Secret Manager (nunca en el repo):

| Secreto | Cómo se genera |
|---|---|
| `aetherio-database-url` | La URL de Neon del paso 1 |
| `aetherio-jwt-secret` | `python -c "import secrets; print(secrets.token_urlsafe(48))"` |
| `aetherio-data-key` | `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"` — **no cambiarla después** |
| `aetherio-google-client-id` / `aetherio-google-client-secret` | Paso 4 |

```bash
echo -n "VALOR" | gcloud secrets create aetherio-jwt-secret --data-file=- --project PROYECTO
```

## 3. Backend (Cloud Run)
1. Crear proyecto GCP (o reutilizar), habilitar Cloud Run, Artifact Registry y Secret Manager.
2. Repositorio de imágenes: `gcloud artifacts repositories create aetherio --repository-format=docker --location=us-central1`.
3. Desplegar (lo mismo que hace `.github/workflows/deploy.yml`):
```bash
cd backend
docker buildx build --platform linux/amd64 -t us-central1-docker.pkg.dev/PROYECTO/aetherio/aetherio-backend:latest --push .
gcloud run deploy aetherio-backend --image us-central1-docker.pkg.dev/PROYECTO/aetherio/aetherio-backend:latest \
  --region us-central1 --allow-unauthenticated \
  --set-secrets DATABASE_URL=aetherio-database-url:latest,JWT_SECRET=aetherio-jwt-secret:latest,DATA_ENCRYPTION_KEY=aetherio-data-key:latest,GOOGLE_CLIENT_ID=aetherio-google-client-id:latest,GOOGLE_CLIENT_SECRET=aetherio-google-client-secret:latest \
  --set-env-vars ENVIRONMENT=production,SESSION_HTTPS_ONLY=true,ADDON_ALLOW_PRIVATE_HOSTS=false,FRONTEND_URL=https://aetherio.pages.dev,GOOGLE_REDIRECT_URI=https://BACKEND/auth/google/callback
```
Con `ENVIRONMENT=production` el backend **no arranca** si falta un secreto o queda algo
inseguro (ver `check_production` en `backend/app/config.py`). Las migraciones corren solas al
arrancar.

## 4. Login con Google
1. https://console.cloud.google.com → APIs y servicios → **Pantalla de consentimiento de
   OAuth**: tipo *Externo*, nombre "AetherIO", email de soporte. Alcances: `openid`, `email`,
   `profile`. Mientras esté en modo *Prueba*, agregar como "usuarios de prueba" las cuentas que
   van a entrar (o publicarla).
2. **Credenciales → Crear credenciales → ID de cliente de OAuth → Aplicación web.**
3. URIs de redireccionamiento autorizados:
   - `http://localhost:8000/auth/google/callback` (local)
   - `https://BACKEND/auth/google/callback` (producción)
4. Copiar el ID y el secreto: en local a `backend/.env` (`GOOGLE_CLIENT_ID`,
   `GOOGLE_CLIENT_SECRET`); en producción a Secret Manager.

La app de Mac abre el navegador del sistema (Google bloquea el login dentro de ventanas de
apps) y vuelve sola por `aetherio://auth/callback`. No requiere configuración extra en Google.

## 5. Frontend (Cloudflare Pages)
```bash
cd frontend
VITE_API_BASE_URL=https://BACKEND npm run build
npx wrangler pages deploy dist --project-name=aetherio
```
`public/_redirects` ya hace que todas las rutas carguen la app.

## 6. App de Mac apuntando a producción
```bash
cd desktop
AETHERIO_API_URL=https://BACKEND npm run dist:prod
```

## 7. CI (opcional)
`.github/workflows/deploy.yml` hace los pasos 3 y 5 al ejecutarlo a mano desde GitHub.
Necesita: variables `GCP_PROJECT`, `BACKEND_URL`, `FRONTEND_URL`; secretos
`GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_SERVICE_ACCOUNT`, `CLOUDFLARE_API_TOKEN`,
`CLOUDFLARE_ACCOUNT_ID`.

## Checklist antes de abrirlo al público
- [ ] `ENVIRONMENT=production` (activa los controles de arranque)
- [ ] `ADDON_ALLOW_PRIVATE_HOSTS=false`
- [ ] Respaldo de `DATA_ENCRYPTION_KEY` fuera de GCP
- [ ] Google OAuth publicado o con usuarios de prueba cargados
- [ ] Revisar límites de intentos de login (pendiente: hoy no hay rate limiting)
