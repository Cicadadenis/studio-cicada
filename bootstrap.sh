#!/bin/bash
set -e

# ═══════════════════════════════════════════════════════════════
#   CICADA STUDIO — ULTRA PROD BOOTSTRAP
#   Автоустановка всего необходимого с нуля
#   Платформы: VPS (Ubuntu/Debian) · WSL · Termux
# ═══════════════════════════════════════════════════════════════

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

ok()   { echo -e "${GREEN}✅ $1${NC}"; }
info() { echo -e "${CYAN}ℹ️  $1${NC}"; }
warn() { echo -e "${YELLOW}⚠️  $1${NC}"; }
err()  { echo -e "${RED}❌ $1${NC}"; exit 1; }
ask()  { echo -e "${BOLD}${YELLOW}▶ $1${NC}"; }

echo ""
echo -e "${BOLD}${CYAN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${CYAN}║      🦟  CICADA STUDIO BOOTSTRAP v1.2       ║${NC}"
echo -e "${BOLD}${CYAN}╚══════════════════════════════════════════════╝${NC}"
echo ""

# ═══════════════════════════════════════════════════════════════
# 0. ОПРЕДЕЛЕНИЕ ПЛАТФОРМЫ
# ═══════════════════════════════════════════════════════════════
detect_platform() {
  if [ -n "$TERMUX_VERSION" ] || [ -d "/data/data/com.termux" ]; then
    echo "termux"
  elif grep -qiE "microsoft|wsl" /proc/version 2>/dev/null; then
    echo "wsl"
  else
    echo "vps"
  fi
}

PLATFORM=$(detect_platform)

case "$PLATFORM" in
  termux)
    info "Платформа: Termux (Android)"
    SUDO=""
    HAS_SYSTEMCTL=false
    ;;
  wsl)
    info "Платформа: WSL (Windows Subsystem for Linux)"
    SUDO="sudo"
    if systemctl list-units &>/dev/null 2>&1; then
      HAS_SYSTEMCTL=true
    else
      HAS_SYSTEMCTL=false
    fi
    ;;
  vps)
    info "Платформа: VPS/сервер (Linux)"
    SUDO=""
    HAS_SYSTEMCTL=true
    ;;
esac

# ─── Вспомогательные функции под платформу ─────────────────────

svc_enable() {
  local svc=$1
  if $HAS_SYSTEMCTL; then
    $SUDO systemctl enable "$svc" 2>/dev/null || true
    $SUDO systemctl start  "$svc" 2>/dev/null || true
  fi
}

svc_reload() {
  local svc=$1
  if $HAS_SYSTEMCTL; then
    $SUDO systemctl reload "$svc" 2>/dev/null || $SUDO systemctl restart "$svc" 2>/dev/null || true
  fi
}

svc_is_active() {
  local svc=$1
  if $HAS_SYSTEMCTL; then
    $SUDO systemctl is-active --quiet "$svc" 2>/dev/null
  else
    pgrep -x "$svc" &>/dev/null
  fi
}

pkg_install() {
  if [ "$PLATFORM" = "termux" ]; then
    pkg install -y "$@"
  else
    $SUDO apt-get install -y -qq "$@"
  fi
}

# ═══════════════════════════════════════════════════════════════
# 0b. ROOT CHECK (только для VPS)
# ═══════════════════════════════════════════════════════════════
if [ "$PLATFORM" = "vps" ] && [ "$EUID" -ne 0 ]; then
  err "Запусти скрипт от root: sudo bash bootstrap.sh"
fi

# ═══════════════════════════════════════════════════════════════
# 1. РЕЖИМ: PROD или LOCAL
# ═══════════════════════════════════════════════════════════════
echo ""
ask "Режим установки:"
echo "  1) PROD  — реальный сервер с доменом и SSL (Let's Encrypt)"
echo "  2) LOCAL — локальный тест без домена (self-signed SSL)"

if [ "$PLATFORM" = "termux" ]; then
  warn "На Termux PROD-режим (SSL/Nginx) недоступен — автоматически: LOCAL"
  MODE_CHOICE=2
else
  read -p "Выбери [1/2]: " MODE_CHOICE
  MODE_CHOICE=${MODE_CHOICE:-1}
fi

if [ "$MODE_CHOICE" = "1" ] && [ "$PLATFORM" != "termux" ]; then
  MODE="prod"
  info "Режим: PRODUCTION"
else
  MODE="local"
  info "Режим: LOCAL TEST"
fi

# ═══════════════════════════════════════════════════════════════
# 2. СБОР ПАРАМЕТРОВ
# ═══════════════════════════════════════════════════════════════
echo ""
echo -e "${BOLD}━━━ Основные настройки ━━━${NC}"

if [ "$MODE" = "prod" ]; then
  read -p "Домен (например: example.com): " DOMAIN
  [ -z "$DOMAIN" ] && err "Домен обязателен"
  read -p "Email для Let's Encrypt: " LE_EMAIL
  [ -z "$LE_EMAIL" ] && err "Email обязателен"
else
  DOMAIN="localhost"
  LE_EMAIL=""
fi

if [ "$MODE" = "prod" ]; then
  PREVIEW_APP_URL="https://${DOMAIN}"
else
  PREVIEW_APP_URL="https://localhost"
fi

# Папка установки = папка где лежит скрипт
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
info "Папка установки: $APP_DIR"

read -p "Порт Node.js сервера [3001]: " API_PORT
API_PORT=${API_PORT:-3001}

echo ""
echo -e "${BOLD}━━━ PostgreSQL ━━━${NC}"
read -p "Имя БД [cicada]: " DB_NAME
DB_NAME=${DB_NAME:-cicada}
read -p "Пользователь БД [cicada_user]: " DB_USER
DB_USER=${DB_USER:-cicada_user}

while true; do
  read -s -p "Пароль БД (мин. 8 символов): " DB_PASSWORD; echo
  [ ${#DB_PASSWORD} -ge 8 ] && break
  warn "Слишком короткий пароль, минимум 8 символов"
done

echo ""
echo -e "${BOLD}━━━ Безопасность ━━━${NC}"
if command -v openssl &>/dev/null; then
  ADMIN_KEY=$(openssl rand -hex 32)
else
  ADMIN_KEY=$(head -c 32 /dev/urandom | xxd -p | tr -d '\n')
fi
info "ADMIN_KEY сгенерирован автоматически: $ADMIN_KEY"
read -p "Использовать этот ключ? [Y/n]: " USE_ADMIN_KEY
if [ "${USE_ADMIN_KEY,,}" = "n" ]; then
  read -p "Введи свой ADMIN_KEY: " ADMIN_KEY
fi

JWT_SECRET=""
read -p "Использовать автоматически сгенерированный JWT_SECRET? [Y/n]: " USE_JWT_SECRET
USE_JWT_SECRET=${USE_JWT_SECRET:-y}
if [ "${USE_JWT_SECRET,,}" = "n" ]; then
  while true; do
    read -s -p "JWT_SECRET (в production не короче 32 символов): " JWT_SECRET; echo
    if [ "$MODE" = "prod" ]; then
      [ ${#JWT_SECRET} -ge 32 ] && break
      warn "Для PROD минимум 32 символа"
    else
      [ ${#JWT_SECRET} -ge 8 ] && break
      warn "Минимум 8 символов"
    fi
  done
fi

read -p "Email администратора: " ADMIN_EMAIL

echo ""
echo -e "${BOLD}━━━ Telegram ━━━${NC}"
read -p "TG_BOT_TOKEN (или Enter чтобы пропустить): " TG_BOT_TOKEN
read -p "Имя бота без @ (или Enter): " TG_BOT_NAME

echo ""
echo -e "${BOLD}━━━ Email (Resend) ━━━${NC}"
read -p "RESEND_API_KEY (или Enter чтобы пропустить): " RESEND_API_KEY
read -p "EMAIL_FROM [noreply@${DOMAIN}]: " EMAIL_FROM
EMAIL_FROM=${EMAIL_FROM:-noreply@${DOMAIN}}

echo ""
echo -e "${BOLD}━━━ CryptoBot ━━━${NC}"
read -p "CRYPTOBOT_TOKEN (или Enter чтобы пропустить): " CRYPTOBOT_TOKEN

echo ""
echo -e "${BOLD}━━━ Google OAuth ━━━${NC}"
read -p "GOOGLE_CLIENT_ID (или Enter чтобы пропустить): " GOOGLE_CLIENT_ID
read -s -p "GOOGLE_CLIENT_SECRET (или Enter чтобы пропустить): " GOOGLE_CLIENT_SECRET; echo
read -p "GOOGLE_CALLBACK_URL [${PREVIEW_APP_URL}/api/auth/google/callback]: " GOOGLE_CALLBACK_URL
GOOGLE_CALLBACK_URL=${GOOGLE_CALLBACK_URL:-${PREVIEW_APP_URL}/api/auth/google/callback}

echo ""
echo -e "${BOLD}━━━ Groq API (AI) ━━━${NC}"
read -s -p "GROQ_TOKEN (или Enter чтобы пропустить): " GROQ_TOKEN; echo
read -s -p "GROQ_TOKEN_2 (или Enter чтобы пропустить): " GROQ_TOKEN_2; echo
read -s -p "GROQ_TOKEN_3 (или Enter чтобы пропустить): " GROQ_TOKEN_3; echo

echo ""
echo -e "${BOLD}━━━ Ollama (локальный AI) ━━━${NC}"
read -p "OLLAMA_URL [http://127.0.0.1:11434]: " OLLAMA_URL
OLLAMA_URL=${OLLAMA_URL:-http://127.0.0.1:11434}
read -p "OLLAMA_MODEL [qwen2.5:3b]: " OLLAMA_MODEL
OLLAMA_MODEL=${OLLAMA_MODEL:-qwen2.5:3b}

echo ""
echo -e "${BOLD}━━━ Доп. защита админки (TOTP) ━━━${NC}"
read -s -p "ADMIN_TOTP_SECRET (опционально; Enter пропустить): " ADMIN_TOTP_SECRET; echo

# ═══════════════════════════════════════════════════════════════
# 3. ПОДТВЕРЖДЕНИЕ
# ═══════════════════════════════════════════════════════════════
echo ""
echo -e "${BOLD}${CYAN}━━━ Итоговые настройки ━━━${NC}"
echo "  Платформа:    $PLATFORM"
echo "  Режим:        $MODE"
echo "  Домен:        $DOMAIN"
echo "  Папка:        $APP_DIR"
echo "  Порт:         $API_PORT"
echo "  БД:           $DB_NAME @ localhost"
echo "  DB_USER:      $DB_USER"
echo "  ADMIN_EMAIL:  $ADMIN_EMAIL"
echo ""
read -p "Всё верно? Начать установку? [Y/n]: " CONFIRM
[ "${CONFIRM,,}" = "n" ] && err "Установка отменена"

# ═══════════════════════════════════════════════════════════════
# 4. СИСТЕМА И ЗАВИСИМОСТИ
# ═══════════════════════════════════════════════════════════════
echo ""
info "Обновляем пакеты..."
if [ "$PLATFORM" = "termux" ]; then
  pkg update -y && pkg upgrade -y
else
  $SUDO apt-get update -qq && $SUDO apt-get upgrade -y -qq
fi
ok "Пакеты обновлены"

# ─── Базовые утилиты ───────────────────────────────────────────
if [ "$PLATFORM" = "termux" ]; then
  pkg install -y curl git openssl-tool
else
  $SUDO apt-get install -y -qq curl git openssl
  [ "$PLATFORM" = "vps" ] && $SUDO apt-get install -y -qq ufw
fi
ok "Базовые утилиты установлены"

# ─── Python 3 ──────────────────────────────────────────────────
if ! command -v python3 &>/dev/null; then
  info "Устанавливаем Python 3..."
  if [ "$PLATFORM" = "termux" ]; then
    pkg install -y python
  else
    $SUDO apt-get install -y -qq python3 python3-pip
  fi
  ok "Python $(python3 --version) установлен"
else
  ok "Python $(python3 --version) уже установлен"
fi

# ─── cicada-tg ─────────────────────────────────────────────────
CICADA_TG_PIN="${CICADA_TG_PIN:-0.3.5}"
info "Устанавливаем cicada-tg==${CICADA_TG_PIN}..."
if [ "$PLATFORM" = "termux" ]; then
  # В Termux Python не системный, --break-system-packages не нужен
  pip install "cicada-tg==${CICADA_TG_PIN}" -q
else
  pip install "cicada-tg==${CICADA_TG_PIN}" --break-system-packages -q
fi
ok "cicada-tg==${CICADA_TG_PIN} установлен"

if command -v cicada &>/dev/null; then
  CICADA_BIN_PATH=$(command -v cicada)
else
  CICADA_BIN_PATH=/usr/local/bin/cicada
  warn "cicada не в PATH — в .env будет CICADA_BIN=$CICADA_BIN_PATH (при необходимости поправь)"
fi

# ─── Node.js ───────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  info "Устанавливаем Node.js 20..."
  if [ "$PLATFORM" = "termux" ]; then
    pkg install -y nodejs
  else
    curl -fsSL https://deb.nodesource.com/setup_20.x | $SUDO bash - &>/dev/null
    $SUDO apt-get install -y -qq nodejs
  fi
  ok "Node.js $(node -v) установлен"
else
  ok "Node.js $(node -v) уже установлен"
fi

# ─── PM2 ───────────────────────────────────────────────────────
if ! command -v pm2 &>/dev/null; then
  info "Устанавливаем PM2..."
  npm install -g pm2 &>/dev/null
  ok "PM2 установлен"
else
  ok "PM2 уже установлен"
fi

# ─── PostgreSQL ────────────────────────────────────────────────
if ! command -v psql &>/dev/null; then
  info "Устанавливаем PostgreSQL..."
  if [ "$PLATFORM" = "termux" ]; then
    pkg install -y postgresql
    mkdir -p "$PREFIX/var/lib/postgresql"
    initdb "$PREFIX/var/lib/postgresql" &>/dev/null || true
  else
    $SUDO apt-get update -qq
    $SUDO apt-get install -y -qq postgresql postgresql-contrib
  fi
  ok "PostgreSQL установлен"
else
  ok "PostgreSQL уже установлен"
fi

# Запуск PostgreSQL
if [ "$PLATFORM" = "termux" ]; then
  pg_ctl -D "$PREFIX/var/lib/postgresql" -l "$PREFIX/var/lib/postgresql/pg.log" start 2>/dev/null || true
elif $HAS_SYSTEMCTL; then
  $SUDO systemctl start postgresql
  $SUDO systemctl enable postgresql
else
  warn "systemctl недоступен — запусти PostgreSQL вручную (service postgresql start)"
fi

# ─── Nginx (только VPS и WSL) ──────────────────────────────────
if [ "$PLATFORM" != "termux" ]; then
  if ! command -v nginx &>/dev/null; then
    info "Устанавливаем Nginx..."
    $SUDO apt-get install -y -qq nginx
    svc_enable nginx
    ok "Nginx установлен"
  else
    ok "Nginx уже установлен"
  fi
else
  warn "Nginx пропущен — не поддерживается на Termux"
fi

# ═══════════════════════════════════════════════════════════════
# 5. POSTGRESQL — СОЗДАНИЕ БД И ПОЛЬЗОВАТЕЛЯ
# ═══════════════════════════════════════════════════════════════
echo ""
info "Настраиваем PostgreSQL..."

pgsql_super() {
  if [ "$PLATFORM" = "termux" ]; then
    psql -U "$(whoami)" "$@"
  else
    sudo -u postgres psql "$@"
  fi
}

pgsql_super << SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${DB_USER}') THEN
    CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASSWORD}';
  ELSE
    ALTER USER ${DB_USER} WITH PASSWORD '${DB_PASSWORD}';
  END IF;
END
\$\$;

SELECT 'CREATE DATABASE ${DB_NAME} OWNER ${DB_USER}'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${DB_NAME}')\gexec

GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};
SQL

pgsql_super -d "$DB_NAME" -c "GRANT ALL ON SCHEMA public TO ${DB_USER};"
ok "БД '${DB_NAME}' и пользователь '${DB_USER}' готовы"

# ═══════════════════════════════════════════════════════════════
# 6. ПРИЛОЖЕНИЕ — ПАПКА И ЗАВИСИМОСТИ
# ═══════════════════════════════════════════════════════════════
echo ""
info "Настраиваем приложение в $APP_DIR..."
mkdir -p "$APP_DIR"
cd "$APP_DIR"


if [ -f "package.json" ]; then
  info "Чистим старые артефакты сборки..."
  rm -rf node_modules package-lock.json dist
  ok "node_modules/, package-lock.json, dist/ удалены"
  info "Устанавливаем npm зависимости..."
  npm install --legacy-peer-deps
  info "Добавляем OAuth/session зависимости..."
  npm install passport passport-google-oauth20 express-session
  ok "npm install выполнен"
  chmod -R 755 "$APP_DIR"
else
  warn "package.json не найден — положи файлы проекта в $APP_DIR и перезапусти скрипт"
fi

# ═══════════════════════════════════════════════════════════════
# 7. .ENV ФАЙЛ
# ═══════════════════════════════════════════════════════════════
echo ""
info "Создаём .env файл..."

if [ -z "${JWT_SECRET:-}" ]; then
  if command -v openssl &>/dev/null; then
    JWT_SECRET=$(openssl rand -hex 32)
  elif command -v python3 &>/dev/null; then
    JWT_SECRET=$(python3 -c "import secrets; print(secrets.token_hex(32))")
  else
    JWT_SECRET=$(head -c 32 /dev/urandom | xxd -p | tr -d '\n')
  fi
  info "JWT_SECRET сгенерирован (${#JWT_SECRET} hex-символов), только в .env"
else
  info "JWT_SECRET задан при опросе (${#JWT_SECRET} символов)"
fi

if [ "$MODE" = "prod" ]; then
  VITE_API_URL="https://${DOMAIN}/api"
  VITE_API_TARGET="https://${DOMAIN}"
  APP_URL_VAL="https://${DOMAIN}"
  NODE_ENV_VAL="production"
else
  VITE_API_URL="https://localhost/api"
  VITE_API_TARGET="https://localhost"
  APP_URL_VAL="https://localhost"
  NODE_ENV_VAL="development"
fi

cat > "$APP_DIR/.env" << ENV
# ─── Server ──────────────────────────────────────────────────
NODE_ENV=${NODE_ENV_VAL}
API_HOST=${DOMAIN}
API_PORT=${API_PORT}
CICADA_BIN=${CICADA_BIN_PATH}
APP_URL=${APP_URL_VAL}

# ─── Vite (фронт) ────────────────────────────────────────────
VITE_API_URL=${VITE_API_URL}
VITE_API_TARGET=${VITE_API_TARGET}
VITE_ADMIN_EMAIL=${ADMIN_EMAIL}
VITE_TG_BOT_NAME=${TG_BOT_NAME}

# ─── PostgreSQL ───────────────────────────────────────────────
DB_HOST=localhost
DB_PORT=5432
DB_NAME=${DB_NAME}
DB_USER=${DB_USER}
DB_PASSWORD=${DB_PASSWORD}

# ─── Безопасность ────────────────────────────────────────────
ADMIN_KEY=${ADMIN_KEY}
JWT_SECRET=${JWT_SECRET}
JWT_EXPIRES_SEC=604800
ADMIN_TOTP_SECRET=${ADMIN_TOTP_SECRET}

# ─── OAuth (Google) ───────────────────────────────────────────
GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID}
GOOGLE_CLIENT_SECRET=${GOOGLE_CLIENT_SECRET}
GOOGLE_CALLBACK_URL=${GOOGLE_CALLBACK_URL}

# ─── AI (Ollama / Groq) ──────────────────────────────────────
OLLAMA_URL=${OLLAMA_URL}
OLLAMA_MODEL=${OLLAMA_MODEL}
GROQ_TOKEN=${GROQ_TOKEN}
GROQ_TOKEN_2=${GROQ_TOKEN_2}
GROQ_TOKEN_3=${GROQ_TOKEN_3}

# ─── Email ───────────────────────────────────────────────────
RESEND_API_KEY=${RESEND_API_KEY}
EMAIL_FROM=${EMAIL_FROM}

# ─── Telegram ────────────────────────────────────────────────
TG_BOT_TOKEN=${TG_BOT_TOKEN}

# ─── CryptoBot ───────────────────────────────────────────────
CRYPTOBOT_TOKEN=${CRYPTOBOT_TOKEN}
ENV

chmod 600 "$APP_DIR/.env"
ok ".env создан (права 600)"

# ═══════════════════════════════════════════════════════════════
# 8. СБОРКА ФРОНТЕНДА
# ═══════════════════════════════════════════════════════════════
if [ -f "$APP_DIR/package.json" ]; then
  echo ""
  info "Собираем фронтенд..."
  cd "$APP_DIR"
  npm run build &>/dev/null \
    && ok "Фронтенд собран (dist/)" \
    || warn "Сборка фронтенда не удалась — проверь вручную: npm run build"
  chmod -R 755 "$APP_DIR/dist" 2>/dev/null || true
fi

# ═══════════════════════════════════════════════════════════════
# 9. NGINX КОНФИГ (только VPS и WSL)
# ═══════════════════════════════════════════════════════════════
if [ "$PLATFORM" != "termux" ]; then
  echo ""
  info "Настраиваем Nginx..."
  NGINX_CONF="/etc/nginx/sites-available/cicada"

  if [ "$MODE" = "prod" ]; then
    $SUDO tee "$NGINX_CONF" > /dev/null << NGINX
server {
    listen 80;
    server_name ${DOMAIN};
    root ${APP_DIR}/dist;
    index index.html;

    location /.well-known/acme-challenge/ { root /var/www/html; }

    location = /satana {
        proxy_pass http://localhost:${API_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
    }

    location = /satana.html { return 301 /satana; }

    location /api/ {
        proxy_pass http://localhost:${API_PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
    }

    location / { try_files \$uri \$uri/ /index.html; }
}
NGINX

  else
    info "Генерируем self-signed сертификат..."
    $SUDO mkdir -p /etc/ssl/cicada
    $SUDO openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
      -keyout /etc/ssl/cicada/privkey.pem \
      -out /etc/ssl/cicada/fullchain.pem \
      -subj "/CN=localhost" &>/dev/null
    ok "Self-signed сертификат создан"

    $SUDO tee "$NGINX_CONF" > /dev/null << NGINX
server {
    listen 80;
    server_name localhost;
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl;
    server_name localhost;

    ssl_certificate /etc/ssl/cicada/fullchain.pem;
    ssl_certificate_key /etc/ssl/cicada/privkey.pem;

    root ${APP_DIR}/dist;
    index index.html;

    location = /satana {
        proxy_pass http://localhost:${API_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
    }

    location = /satana.html { return 301 /satana; }

    location /api/ {
        proxy_pass http://localhost:${API_PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
    }

    location / { try_files \$uri \$uri/ /index.html; }
}
NGINX
  fi

  $SUDO ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/cicada
  $SUDO rm -f /etc/nginx/sites-enabled/default
  $SUDO nginx -t && svc_reload nginx
  ok "Nginx настроен"
fi

# ═══════════════════════════════════════════════════════════════
# 10. SSL — LET'S ENCRYPT (только PROD на VPS)
# ═══════════════════════════════════════════════════════════════
if [ "$MODE" = "prod" ] && [ "$PLATFORM" = "vps" ]; then
  echo ""
  info "Получаем SSL сертификат Let's Encrypt..."
  if ! command -v certbot &>/dev/null; then
    apt-get install -y -qq certbot python3-certbot-nginx
  fi
  certbot --nginx \
    -d "$DOMAIN" \
    --email "$LE_EMAIL" \
    --agree-tos \
    --non-interactive \
    --redirect \
    && ok "SSL сертификат получен и настроен" \
    || warn "Не удалось получить сертификат. Проверь что домен указывает на этот сервер."
fi

# ═══════════════════════════════════════════════════════════════
# 11. FIREWALL (только VPS)
# ═══════════════════════════════════════════════════════════════
if [ "$PLATFORM" = "vps" ]; then
  echo ""
  info "Настраиваем firewall (UFW)..."
  ufw --force enable &>/dev/null
  ufw allow ssh  &>/dev/null
  ufw allow 80   &>/dev/null
  ufw allow 443  &>/dev/null
  ok "Firewall: открыты порты 22, 80, 443"
else
  warn "Firewall (UFW) пропущен — не нужен на $PLATFORM"
fi

# ═══════════════════════════════════════════════════════════════
# 12. PM2 — ЗАПУСК СЕРВЕРА
# ═══════════════════════════════════════════════════════════════
echo ""
info "Запускаем Node.js сервер через PM2..."
cd "$APP_DIR"

pm2 delete server 2>/dev/null || true
pm2 start server.mjs --name server
pm2 save

if $HAS_SYSTEMCTL && [ "$PLATFORM" = "vps" ]; then
  pm2 startup systemd -u root --hp /root &>/dev/null || true
  ok "PM2 autostart настроен (systemd)"
elif [ "$PLATFORM" = "termux" ]; then
  if [ -d "$HOME/.termux/boot" ]; then
    cat > "$HOME/.termux/boot/cicada.sh" << 'BOOT'
#!/data/data/com.termux/files/usr/bin/bash
pg_ctl -D "$PREFIX/var/lib/postgresql" start
cd "$HOME/cicada" && pm2 resurrect
BOOT
    chmod +x "$HOME/.termux/boot/cicada.sh"
    ok "Автозапуск настроен через Termux:Boot"
  else
    warn "Установи приложение Termux:Boot для автозапуска при перезагрузке"
  fi
else
  warn "Автозапуск PM2: настрой вручную (systemctl или rc.local)"
fi

ok "Сервер запущен через PM2"

# ─── Выдаём pro-план администратору ───────────────────────────
if [ -n "$ADMIN_EMAIL" ]; then
  echo ""
  info "Выдаём pro-план администратору ($ADMIN_EMAIL)..."
  sleep 3
  pgsql_super -d "$DB_NAME" -c \
    "UPDATE users SET plan='pro', role='admin', subscription_exp=9999999999999 WHERE email='${ADMIN_EMAIL}';" \
    &>/dev/null \
    && ok "Pro-план и роль admin выданы администратору" \
    || warn "Пользователь ${ADMIN_EMAIL} ещё не зарегистрирован — зайди в аккаунт и затем выполни вручную:
    sudo -u postgres psql -d ${DB_NAME} -c \"UPDATE users SET plan='pro', role='admin', subscription_exp=9999999999999 WHERE email='${ADMIN_EMAIL}';\""
fi

# ═══════════════════════════════════════════════════════════════
# 13. ПРОВЕРКА
# ═══════════════════════════════════════════════════════════════
echo ""
info "Проверяем всё..."
sleep 3

pgsql_super -d "$DB_NAME" -c "SELECT COUNT(*) FROM users;" &>/dev/null \
  && ok "PostgreSQL: таблица users существует" \
  || warn "PostgreSQL: таблица users ещё не создана (создастся при старте сервера)"

pm2 list | grep -q "online" \
  && ok "PM2: сервер online" \
  || warn "PM2: сервер не запустился — проверь: pm2 logs server"

if [ "$PLATFORM" != "termux" ]; then
  svc_is_active nginx \
    && ok "Nginx: работает" \
    || warn "Nginx: не работает"
fi

# ═══════════════════════════════════════════════════════════════
# 14. ИТОГ
# ═══════════════════════════════════════════════════════════════
echo ""
echo -e "${BOLD}${GREEN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${GREEN}║           ✅ УСТАНОВКА ЗАВЕРШЕНА             ║${NC}"
echo -e "${BOLD}${GREEN}╚══════════════════════════════════════════════╝${NC}"
echo ""

if [ "$MODE" = "prod" ]; then
  echo -e "  🌐 Сайт:        ${BOLD}https://${DOMAIN}${NC}"
  echo -e "  🔐 Админка:     ${BOLD}https://${DOMAIN}/satana${NC}"
elif [ "$PLATFORM" = "termux" ]; then
  echo -e "  🌐 API:         ${BOLD}http://localhost:${API_PORT}${NC}"
  echo -e "  🔐 Админка:     ${BOLD}http://localhost:${API_PORT}/satana${NC}"
  warn "Nginx не запущен — доступ напрямую через порт ${API_PORT}"
else
  echo -e "  🌐 Сайт:        ${BOLD}https://localhost${NC}"
  echo -e "  🔐 Админка:     ${BOLD}https://localhost/satana${NC}"
  warn "Браузер покажет предупреждение о сертификате — это нормально для локального теста"
fi

echo ""
echo -e "  🖥️  Платформа:  ${BOLD}${PLATFORM}${NC}"
echo -e "  🗄️  БД:          ${BOLD}${DB_NAME}${NC} / user: ${BOLD}${DB_USER}${NC}"
echo -e "  🔑 ADMIN_KEY:   ${BOLD}${ADMIN_KEY}${NC}"
echo -e "  📁 Папка:       ${BOLD}${APP_DIR}${NC}"
echo ""
echo -e "  Полезные команды:"
echo -e "    ${CYAN}pm2 logs server${NC}         — логи сервера"
echo -e "    ${CYAN}pm2 restart server${NC}      — перезапуск"
if [ "$PLATFORM" != "termux" ]; then
  echo -e "    ${CYAN}nginx -t && systemctl reload nginx${NC} — перезагрузка nginx"
fi
if [ "$PLATFORM" = "termux" ]; then
  echo -e "    ${CYAN}psql -U $(whoami) -d ${DB_NAME}${NC} — консоль БД"
  echo -e "    ${CYAN}pg_ctl -D \$PREFIX/var/lib/postgresql start${NC} — запуск PostgreSQL"
else
  echo -e "    ${CYAN}sudo -u postgres psql -d ${DB_NAME}${NC} — консоль БД"
fi
echo ""
echo -e "  .env находится в: ${BOLD}${APP_DIR}/.env${NC}"
echo ""
