FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq-dev gcc \
    && rm -rf /var/lib/apt/lists/*

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
