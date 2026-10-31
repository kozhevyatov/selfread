# ---------- 1. Сборка фронтенда ----------
FROM node:22-alpine AS frontend
WORKDIR /src
COPY frontend/package*.json ./
RUN npm install --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# ---------- 2. Бэкенд + статика ----------
FROM python:3.12-slim-trixie

# poppler-utils — обложки PDF (первая страница), djvulibre-bin — обложки и страницы DjVu,
# pandoc — DOCX/ODT/RTF/CHM → EPUB, libarchive-tools и unar — комиксы CBR/CB7, libchm-bin — распаковка CHM
RUN apt-get update \
    && apt-get install -y --no-install-recommends poppler-utils djvulibre-bin pandoc libarchive-tools unar libchm-bin \
    && rm -rf /var/lib/apt/lists/*

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DATA_DIR=/data \
    MEDIA_ROOT=/library \
    UPLOAD_ROOT=/uploads \
    STATIC_DIR=/app/static \
    PORT=1334

WORKDIR /app
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ ./
COPY --from=frontend /src/dist ./static

VOLUME /data
EXPOSE 1334

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import os,urllib.request; urllib.request.urlopen(f'http://127.0.0.1:{os.environ[\"PORT\"]}/api/health', timeout=4)"

# Заголовки X-Forwarded-* (реальный IP и https) принимаем только от прокси из локальных сетей:
# reverse proxy DSM ходит в контейнер через docker-сеть 172.x. От остальных — игнорируем,
# иначе можно подделать IP и обойти защиту от перебора паролей.
ENV FORWARDED_ALLOW_IPS="127.0.0.1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16"
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips=\"${FORWARDED_ALLOW_IPS}\" --timeout-keep-alive 30"]
