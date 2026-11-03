# AetherIO

Reproductor compatible con los **addons de Stremio**, pensado para público hispanohablante.
Instalas un addon pegando la URL de su `manifest.json` y AetherIO muestra sus catálogos,
fichas y streams, prioriza el **español latino** y recuerda por dónde vas en cada dispositivo.

Funciona como **web**, **app de macOS y Windows** y **app de Android** (TV y celular, un solo
APK). La app de escritorio agrega un servidor de video local (ffmpeg) que reproduce lo que el
navegador no puede: audio AC3/DTS, elegir la pista de audio de un archivo, MKV/HEVC, subtítulos
internos y transmitir a la TV.

## Descargas

Última versión (un clic y se descarga):

| Plataforma | Descarga |
|---|---|
| **Android / Android TV** | [⬇ AetherIO.apk](https://github.com/OzLoup/aetherio/releases/latest/download/AetherIO.apk) |
| **Windows** (64 bits) | [⬇ AetherIO-Setup.exe](https://github.com/OzLoup/aetherio/releases/latest/download/AetherIO-Setup.exe) |
| **macOS** (Apple Silicon) | [⬇ AetherIO-mac.dmg](https://github.com/OzLoup/aetherio/releases/latest/download/AetherIO-mac.dmg) |
| **Web** | [aetherio-2y3.pages.dev](https://aetherio-2y3.pages.dev) |

Versiones anteriores y notas de cambios: [Releases](https://github.com/OzLoup/aetherio/releases).
Windows avisa con SmartScreen y macOS con Gatekeeper porque las apps no están firmadas por una
autoridad: en Windows "Más información → Ejecutar de todas formas"; en macOS, clic derecho → Abrir.

> AetherIO no aloja, no distribuye y **no recomienda** contenido, addons ni listas: los perfiles
> nuevos solo traen addons de metadatos (información de los títulos, sin videos): Catálogos AetherIO
> (TMDB) y Cinemeta como respaldo de fichas, con sus catálogos ocultos. Todo lo que se reproduce viene
> de las fuentes que cada usuario agrega bajo su propia responsabilidad (ver `/legal` en la app).

## Funciones

- **Catálogos AetherIO** (datos de TMDB y JustWatch, servidos por el propio backend como un addon
  más): qué hay en **Netflix, Prime Video, Disney+, Max, Apple TV+ y Paramount+** en cada país,
  Tendencias y Estrenos, con títulos, sinopsis y pósters **en el idioma del país**. Género y orden
  (popularidad, fecha, valoración, A–Z) se aplican sobre todo el catálogo. También hace la
  **búsqueda** y las **fichas** (reparto, tráiler, temporadas y capítulos), así que la app funciona
  aunque Cinemeta no esté.
- **Títulos similares** en cada ficha (recomendaciones de TMDB).
- **Addons de Stremio**: instalar por URL (también enlaces `stremio://`) o desde el **buscador de
  addons de la comunidad** (directorios de Stremio y stremio-addons.net), ordenar por prioridad,
  activar/desactivar, configurar y elegir si sus catálogos salen en **Inicio y Descubrir** (oculto,
  sigue respondiendo búsquedas y fichas). Los perfiles nuevos traen Catálogos AetherIO y Cinemeta
  (oculto, como respaldo de fichas). Las URLs de addons (que pueden llevar API keys) se guardan
  **cifradas** en la base de datos.
- **Cuentas y perfiles** estilo Netflix (hasta 5): cada perfil tiene sus addons, idioma,
  historial y ajustes. Login con email/contraseña o **Google**.
- **Explorar**: Inicio con destacados y filas de catálogos, Descubrir con filtros y orden (A–Z,
  más recientes), búsqueda y fichas con temporadas y episodios. En la pantalla de fuentes,
  botones de **capítulo anterior / siguiente**.
- **Streams ordenados para tu idioma**: detecta latino/castellano/inglés, calidad, si ya está en
  la caché de tu debrid, y avisa de formatos problemáticos. Un idioma que el addon solo indica con
  una bandera (puede ser el de los subtítulos) se muestra como **"Latino?"** y va después de los
  confirmados; las fuentes que piden el plan premium de su addon (🔒) van al final. En la app de
  escritorio verifica las **pistas de audio reales** de los primeros streams ("✓ Latino").
- **Reproductor**: subtítulos (OpenSubtitles y los del archivo), cambio de idioma y de calidad
  siguiendo en el mismo minuto, **siguiente episodio** (botón en los controles y al final, que
  elige solo la mejor fuente), barra que salta al instante y muestra el tiempo al pasar el puntero
  o arrastrar, aviso claro cuando una fuente devuelve un video corto (aviso del addon o del
  debrid), HLS adaptativo y atajos de teclado. Al salir o cerrar la app suelta la conexión con la
  fuente (para servicios que cuentan sesiones abiertas).
- **Control remoto (Android TV)**: navegación con flechas, campos de texto que solo se editan con
  OK (no abren el teclado al pasar), menús que se abren con OK y flechas mantenidas fluidas. El
  reproductor nativo muestra el tiempo grande al moverse por la barra.
- **TV en vivo**: canales de addons de TV y listas IPTV (M3U) que agrega cada perfil, con
  búsqueda y filtros por categoría y país.
- **Control parental**: PIN de la cuenta; el contenido +18 está apagado en cada perfil hasta
  activarlo con el PIN, y los addons/listas +18 solo se instalan en perfiles que lo permitan.
- **Continuar viendo, historial y vistos**, sincronizados entre dispositivos.
- **Transmitir a la TV**: Google Cast y AirPlay desde el navegador; desde la app de Mac,
  Chromecast/Google TV y Smart TVs DLNA (el Mac adapta el video si la TV no lo soporta).
- **Interfaz en español e inglés**, tema oscuro/claro **con el color del perfil** (el del avatar;
  sin perfil, el azul de la marca `#12518b`), animaciones que respetan "reducir movimiento".

## Estructura

| Carpeta | Qué es |
|---|---|
| `backend/` | API en **Python 3.12 + FastAPI**, SQLAlchemy, Alembic, JWT propio + Google OAuth |
| `frontend/` | Web en **React + Vite + TypeScript**, Tailwind CSS v4, Radix UI (patrón shadcn/ui), lucide-react, `motion`, Blossom Carousel |
| `desktop/` | App de macOS y Windows: **Electron** con la misma web + servidor de video local con ffmpeg/ffprobe y transmisión (Chromecast/DLNA) |
| `android/` | App de Android (TV y móvil): la misma web en un WebView + reproductor nativo ExoPlayer con ffmpeg (MKV, HEVC, AC3/DTS, pistas de audio) |
| `docker-compose.yml` | PostgreSQL local (y el backend, opcional) |
| `DEPLOY.md` | Guía de despliegue (Cloud Run + Cloudflare Pages + Neon) |
| `.github/workflows/` | `deploy.yml` (despliegue al fusionar en `main`) y `release.yml` (instaladores) |

El video **nunca pasa por el backend**: los catálogos y streams se piden directo a los addons
desde el cliente, y el video va del proveedor al navegador, a la app o a la TV. El backend maneja
cuentas, perfiles, addons y progreso, y sirve los Catálogos AetherIO (solo metadatos de TMDB, con
caché).

## Desarrollo local

Requisitos: Python 3.12, Node.js 22+, Docker.

```bash
# 1. Base de datos (puerto 5433; si está ocupado: DB_PORT=5434 docker compose up -d db
#    y ajusta el puerto en DATABASE_URL de backend/.env)
docker compose up -d db

# 2. Backend → http://localhost:8000 (documentación en /docs)
cd backend
python3.12 -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt
cp .env.example .env          # completa JWT_SECRET y DATA_ENCRYPTION_KEY (instrucciones dentro)
                              # y TMDB_API_KEY para los Catálogos AetherIO (opcional)
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

La clave de TMDB es gratuita (themoviedb.org → Configuración → API; sirve la "API Key" o el "API
Read Access Token"). Sin ella los Catálogos AetherIO y los títulos similares se apagan solos.

Antes de dar algo por terminado: `pytest`, `npx tsc -b --noEmit`, `npx vitest run` y
`npm run build` limpios.

## App de escritorio (macOS y Windows)

```bash
cd desktop
npm install                   # si falta Electron: node node_modules/electron/install.js
npm run dev                   # macOS: usa la web de localhost:5173 (Windows: npm run dev:win)
npm test                      # pruebas del servidor de video local
npm run dist                  # macOS → dist/AetherIO-<versión>-arm64.dmg
AETHERIO_API_URL=https://tu-backend npm run dist:prod        # macOS apuntando a producción
npm run dist:win              # Windows → dist/AetherIO-Setup-<versión>.exe
VITE_API_BASE_URL=https://tu-backend npm run dist:win:prod   # Windows apuntando a producción
```

- Windows: instalador NSIS de 64 bits con accesos directos; registra `aetherio://` para el login
  con Google. Sin certificado de firma, SmartScreen avisa al instalar.

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
tu propia llave; sin él se usa la llave de depuración. Nunca subas la llave al repo. **Usa siempre
la misma llave**: Android solo actualiza la app instalada si el APK nuevo está firmado igual.

## Versiones y releases

Los cambios de **web y backend** llegan solos al fusionar en `main` (se despliegan, y la app de
Android/TV carga la web publicada). Un **release** solo hace falta cuando cambian las apps
instaladas: código nativo de Android, app de escritorio o íconos.

1. Sube la versión en `android/app/build.gradle.kts` (`versionCode` +1 y `versionName`) y en
   `desktop/package.json` (`npm version X.Y.Z --no-git-tag-version`).
2. Publica: crea un release en GitHub con una etiqueta nueva `vX.Y.Z`, sube la etiqueta
   (`git tag vX.Y.Z && git push origin vX.Y.Z`) o usa *Actions → Release → Run workflow*.
3. `release.yml` compila el APK, el `.exe` y el `.dmg` y los adjunta con nombres fijos, así que
   los enlaces de **Descargas** apuntan siempre a la última versión.

El APK se firma en GitHub con los secretos `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`,
`ANDROID_KEY_ALIAS` y `ANDROID_KEY_PASSWORD`.

## API (resumen)

Todas las rutas de perfil usan el header `X-Profile-Id`.

| Ruta | Para qué |
|---|---|
| `POST /auth/register`, `/auth/login`, `GET/PATCH /auth/me`, `POST /auth/password` | Cuenta |
| `GET /auth/providers`, `/auth/google/login`, `/auth/google/callback` | Login con Google (web y app de Mac vía `aetherio://`) |
| `GET/POST/PATCH/DELETE /profiles` | Perfiles y sus ajustes (idioma de la app, audio, subtítulos, calidad máxima) |
| `GET/POST /addons`, `POST /addons/preview`, `PUT /addons/order`, `PATCH/DELETE /addons/{id}`, `POST /addons/{id}/refresh` | Addons del perfil |
| `PUT/GET/DELETE /progress/video/{id}`, `GET /progress/meta/{id}`, `POST /progress/watched`, `GET /progress/continue`, `GET /progress/history` | Progreso, vistos, historial |
| `GET /stremio/tmdb/{país}/manifest.json`, `…/catalog/…`, `…/meta/…` | Catálogos AetherIO como addon de Stremio (público, solo lectura) |
| `GET /stremio/tmdb/countries.json`, `GET /stremio/tmdb/similar/{tipo}/{imdb}.json?lang=` | Países disponibles y títulos similares |

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
en Neon, secretos en Google Secret Manager (incluida `aetherio-tmdb-key`). Con poco tráfico entra
en los niveles gratuitos.

**Automático**: cada push a `main` (al fusionar un PR) corre `.github/workflows/deploy.yml`, que
prueba y despliega el backend (las migraciones corren al arrancar) y la web. También se puede
lanzar a mano en *Actions → Deploy → Run workflow*. Necesita en GitHub las variables
`GCP_PROJECT`, `BACKEND_URL` y `FRONTEND_URL`, y los secretos `GCP_WORKLOAD_IDENTITY_PROVIDER`,
`GCP_SERVICE_ACCOUNT` (acceso sin contraseñas, limitado a este repo), `CLOUDFLARE_API_TOKEN` (con
permiso *Cloudflare Pages: Edit*) y `CLOUDFLARE_ACCOUNT_ID`.

Los datos de títulos de los Catálogos AetherIO vienen de [TMDB](https://www.themoviedb.org) y
JustWatch; su API se usa con atribución y para uso no comercial.
