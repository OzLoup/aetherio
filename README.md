# AetherIO

Reproductor compatible con los **addons de Stremio**, pensado para público hispanohablante.
Instalas un addon pegando la URL de su `manifest.json` y AetherIO muestra sus catálogos,
fichas y streams, prioriza el **español latino** y recuerda por dónde vas en cada dispositivo.

Funciona como **web**, **app de macOS** y **app de Android** (TV y celular, un solo APK). La app de Mac agrega un servidor de video
local (ffmpeg) que reproduce lo que el navegador no puede: audio AC3/DTS, elegir la pista de
audio de un archivo, MKV/HEVC, subtítulos internos y transmitir a la TV.

> AetherIO no aloja ni distribuye contenido. Todo lo que se reproduce viene de los addons que
> cada usuario instala bajo su propia responsabilidad.

## Funciones

- **Addons de Stremio**: instalar por URL (también enlaces `stremio://`), ordenar por prioridad,
  activar/desactivar, configurar. Las URLs de addons (que pueden llevar API keys) se guardan
  **cifradas** en la base de datos.
- **Cuentas y perfiles** estilo Netflix (hasta 5): cada perfil tiene sus addons, idioma,
  historial y ajustes. Login con email/contraseña o **Google**.
- **Explorar**: Inicio con destacados y filas de catálogos, Descubrir con filtros, búsqueda y
  fichas con temporadas y episodios.
- **Streams ordenados para tu idioma**: detecta latino/castellano/inglés, calidad, si ya está en
  la caché de tu debrid, y avisa de formatos problemáticos. En la app de Mac verifica las
  **pistas de audio reales** de los primeros streams ("✓ Latino").
- **Reproductor**: subtítulos (OpenSubtitles y los del archivo), cambio de idioma y de calidad
  siguiendo en el mismo minuto, aviso de conexión lenta, HLS adaptativo, atajos de teclado y
  control remoto.
- **Continuar viendo, historial y vistos**, sincronizados entre dispositivos.
- **Transmitir a la TV**: Google Cast y AirPlay desde el navegador; desde la app de Mac,
  Chromecast/Google TV y Smart TVs DLNA (el Mac adapta el video si la TV no lo soporta).
- **Interfaz en español e inglés**, tema oscuro/claro, animaciones que respetan "reducir
  movimiento".

## Estructura

| Carpeta | Qué es |
|---|---|
| `backend/` | API en **Python 3.12 + FastAPI**, SQLAlchemy, Alembic, JWT propio + Google OAuth |
| `frontend/` | Web en **React + Vite + TypeScript**, Tailwind CSS v4, Radix UI (patrón shadcn/ui), lucide-react, `motion`, Blossom Carousel |
| `desktop/` | App de macOS: **Electron** con la misma web + servidor de video local con ffmpeg/ffprobe y transmisión (Chromecast/DLNA) |
| `android/` | App de Android (TV y móvil): la misma web en un WebView + reproductor nativo ExoPlayer con ffmpeg (MKV, HEVC, AC3/DTS, pistas de audio) |
| `docker-compose.yml` | PostgreSQL local (y el backend, opcional) |
| `DEPLOY.md` | Guía de despliegue (Cloud Run + Cloudflare Pages + Neon) |

El video **nunca pasa por el backend**: los catálogos y streams se piden directo a los addons
desde el cliente, y el video va del proveedor al navegador, a la app o a la TV. El backend solo
maneja cuentas, perfiles, addons y progreso.

## Desarrollo local

Requisitos: Python 3.12, Node.js 22+, Docker.

```bash
# 1. Base de datos (puerto 5433; si está ocupado: DB_PORT=5434 docker compose up -d db
#    y ajusta el puerto en DATABASE_URL de backend/.env)
docker compose up -d db

# 2. Backend → http://localhost:8000 (documentación en /docs)
cd backend
python3.12 -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env          # completa JWT_SECRET y DATA_ENCRYPTION_KEY (instrucciones dentro)
alembic upgrade head
uvicorn app.main:app --reload
pytest

# 3. Web → http://localhost:5173
cd frontend
npm install
cp .env.example .env
npm run dev
npx vitest run                # pruebas
```

Para el login con Google en local, crea un cliente OAuth ("Aplicación web") en Google Cloud
Console con el redirect `http://localhost:8000/auth/google/callback` y pon el ID y el secreto
en `backend/.env`. Sin ellos, el botón de Google simplemente no aparece.

Antes de dar algo por terminado: `pytest`, `npx tsc -b --noEmit`, `npx vitest run` y
`npm run build` limpios.

## App de macOS

```bash
cd desktop
npm install                   # si falta Electron: node node_modules/electron/install.js
npm run dev                   # usa la web de localhost:5173
npm test                      # pruebas del servidor de video local
npm run dist                  # → dist/AetherIO-<versión>-arm64.dmg
AETHERIO_API_URL=https://tu-backend npm run dist:prod   # apuntando a producción
```

- Trae su propio ffmpeg; no hace falta instalarlo.
- **Firma**: sin cuenta de Apple Developer el `.dmg` se firma "ad-hoc", y macOS niega en silencio
  la **red local** (necesaria para transmitir a la TV). Para evitarlo, crea en *Acceso a Llaveros
  → Asistente de Certificados* un certificado de **Firma de código** llamado `AetherIO Local`,
  márcalo como "Confiar siempre", y la build lo usará automáticamente (`desktop/build/sign.cjs`).
- En otros Mac, la primera vez se abre con *Ajustes → Privacidad y seguridad → Abrir de todos
  modos*.
- Si lanzas Electron desde la terminal de VS Code, quita `ELECTRON_RUN_AS_NODE`
  (el script `dev` ya lo hace).

## App de Android

Un solo APK para Android TV y Android normal. Carga la web publicada y reproduce con
ExoPlayer + ffmpeg, así que abre formatos que el navegador no puede.

```bash
cd android
# Requiere JDK 17 y el Android SDK (platform 36). local.properties → sdk.dir=…
./gradlew assembleRelease     # → app/build/outputs/apk/release/app-release.apk
./gradlew assembleRelease -PwebUrl=http://192.168.1.10:5173   # apuntando a otra web
```

Firma: crea `android/keystore.properties` (storeFile, storePassword, keyAlias, keyPassword) con
tu propia llave; sin él se usa la llave de depuración. Nunca subas la llave al repo.

## API (resumen)

Todas las rutas de perfil usan el header `X-Profile-Id`.

| Ruta | Para qué |
|---|---|
| `POST /auth/register`, `/auth/login`, `GET/PATCH /auth/me`, `POST /auth/password` | Cuenta |
| `GET /auth/providers`, `/auth/google/login`, `/auth/google/callback` | Login con Google (web y app de Mac vía `aetherio://`) |
| `GET/POST/PATCH/DELETE /profiles` | Perfiles y sus ajustes (idioma de la app, audio, subtítulos, calidad máxima) |
| `GET/POST /addons`, `POST /addons/preview`, `PUT /addons/order`, `PATCH/DELETE /addons/{id}`, `POST /addons/{id}/refresh` | Addons del perfil |
| `PUT/GET/DELETE /progress/video/{id}`, `GET /progress/meta/{id}`, `POST /progress/watched`, `GET /progress/continue`, `GET /progress/history` | Progreso, vistos, historial |

## Seguridad

- Nunca se versionan secretos: `.env`, certificados y respaldos están en `.gitignore`. Usa los
  `.env.example` como plantilla.
- En producción (`ENVIRONMENT=production`) el backend **se niega a arrancar** si falta un secreto
  o queda algo inseguro activado (ver `check_production` en `backend/app/config.py`).
- `DATA_ENCRYPTION_KEY` cifra las URLs de addons: guárdala bien; si se pierde, esas URLs no se
  pueden leer.
- `ADDON_ALLOW_PRIVATE_HOSTS=false` en cualquier servidor público (protección SSRF).

## Despliegue

Ver [DEPLOY.md](DEPLOY.md): backend en Google Cloud Run, web en Cloudflare Pages, base de datos
en Neon, secretos en Google Secret Manager. Con poco tráfico entra en los niveles gratuitos.
