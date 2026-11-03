FROM python:3.12-slim

# No compiler or libpq headers: psycopg[binary] ships its own libpq, so the
# image stays small (faster Cloud Run cold starts, less to patch).
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Don't run as root.
RUN useradd --create-home --uid 10001 aetherio && chown -R aetherio /app
USER aetherio

EXPOSE 8000

# Cloud Run injects $PORT (usually 8080); default 8000 for local use.
# --proxy-headers: behind Cloud Run's HTTPS proxy, so URLs are https.
CMD alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips="*"
