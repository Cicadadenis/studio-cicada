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
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
WHITE='\033[1;37m'
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m'
ORANGE='\033[38;5;208m'
VIOLET='\033[38;5;141m'
TEAL='\033[38;5;45m'

ui_init() {
  if [ -n "${NO_COLOR:-}" ] || [ ! -t 1 ]; then
    RED='' GREEN='' YELLOW='' CYAN='' BLUE='' MAGENTA='' WHITE='' DIM='' BOLD='' NC=''
    ORANGE='' VIOLET='' TEAL=''
  fi
}
ui_init

ok()   { echo -e "  ${GREEN}✔${NC}  ${WHITE}$1${NC}"; }
info() { echo -e "  ${CYAN}ℹ${NC}  ${WHITE}$1${NC}"; }
warn() { echo -e "  ${YELLOW}⚠${NC}  ${YELLOW}$1${NC}"; }
err()  { echo -e "  ${RED}✖${NC}  ${RED}${BOLD}$1${NC}"; exit 1; }
dim()  { echo -e "  ${DIM}$1${NC}"; }
hint() { echo -e "  ${DIM}↳${NC} $1"; }

divider() {
  echo -e "${DIM}  ────────────────────────────────────────────────────────────${NC}"
}

section() {
  echo ""
  divider
  echo -e "${BOLD}${MAGENTA}  ▣  $1${NC}"
  divider
}

subsection() {
  echo -e "${BOLD}${TEAL}  ▸ $1${NC}"
}

ask() {
  echo ""
  echo -e "${BOLD}${ORANGE}  ▶  $1${NC}"
}

prompt() {
  local __var=$1
  shift
  echo -en "${BLUE}  │ ${NC}${WHITE}$*${NC}: "
  read -r "$__var"
}

prompt_def() {
  local __var=$1
  local __def=$2
  shift 2
  echo -en "${BLUE}  │ ${NC}${WHITE}$*${NC} ${DIM}[${CYAN}${__def}${DIM}]${NC}: "
  read -r "$__var"
  if [ -z "${!__var}" ]; then
    printf -v "$__var" '%s' "$__def"
  fi
}

prompt_secret() {
  local __var=$1
  shift
  echo -en "${BLUE}  │ ${NC}${WHITE}$*${NC}: "
  read -rs "$__var"
  echo ""
}

prompt_yn() {
  local __var=$1
  local __def=$2
  shift 2
  echo -en "${BLUE}  │ ${NC}${WHITE}$*${NC} ${DIM}[${CYAN}${__def}${DIM}]${NC}: "
  read -r "$__var"
  if [ -z "${!__var}" ]; then
    printf -v "$__var" '%s' "$__def"
  fi
}

choice_line() {
  echo -e "     ${BOLD}${VIOLET}$1)${NC} ${WHITE}$2${NC} ${DIM}— $3${NC}"
}

summary_row() {
  local key=$1 val=$2 color=${3:-$WHITE}
  printf "  ${DIM}%-16s${NC} ${color}%s${NC}\n" "$key:" "$val"
}

summary_box_begin() {
  echo ""
  echo -e "${BOLD}${CYAN}  ╭─ Итоговые настройки ─────────────────────────────────────╮${NC}"
}

summary_box_end() {
  echo -e "${BOLD}${CYAN}  ╰──────────────────────────────────────────────────────────╯${NC}"
}

platform_chip() {
  local label=$1
  case "$PLATFORM" in
    wsl)    echo -e "${TEAL}${label}${NC} ${DIM}(Windows Subsystem for Linux)${NC}" ;;
    termux) echo -e "${ORANGE}${label}${NC} ${DIM}(Android)${NC}" ;;
    *)      echo -e "${GREEN}${label}${NC} ${DIM}(Linux server)${NC}" ;;
  esac
}

mode_chip() {
  if [ "$MODE" = "prod" ]; then
    echo -e "${GREEN}PRODUCTION${NC}"
  else
    echo -e "${ORANGE}LOCAL TEST${NC}"
  fi
}

print_banner() {
  echo ""
  echo -e "${ORANGE}  ╔══════════════════════════════════════════════════════════╗${NC}"
  echo -e "${ORANGE}  ║${NC}${BOLD}${WHITE}           🦟  CICADA STUDIO BOOTSTRAP v1.4              ${NC}${ORANGE}║${NC}"
  echo -e "${ORANGE}  ║${NC}${DIM}        Установка · настройка · первый запуск            ${NC}${ORANGE}║${NC}"
  echo -e "${ORANGE}  ╚══════════════════════════════════════════════════════════╝${NC}"
  echo ""
}

INSTALL_STEP=0
install_phase() {
  INSTALL_STEP=$((INSTALL_STEP + 1))
  echo ""
  echo -e "${BOLD}${VIOLET}  ┌─ Шаг ${INSTALL_STEP}/${INSTALL_TOTAL:-12}${NC}  ${CYAN}$1${NC}"
  echo -e "${DIM}  └────────────────────────────────────────────────────────${NC}"
}

print_banner

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
    info "Платформа: $(platform_chip Termux)"
    SUDO=""
    HAS_SYSTEMCTL=false
    PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
    TERMUX_PKG_USER=$(stat -c '%U' "$PREFIX" 2>/dev/null || stat -f '%Su' "$PREFIX" 2>/dev/null || true)
    if [ "$(id -u)" -eq 0 ]; then
      warn "Termux: pkg не работает от root — пакеты ставим от пользователя ${TERMUX_PKG_USER:-termux}"
      case "${PWD:-}" in
        /root/*) warn "Проект в /root — лучше клонировать в \$HOME/cicada-studio и запускать без su/root" ;;
      esac
    fi
    ;;
  wsl)
    info "Платформа: $(platform_chip WSL)"
    SUDO="sudo"
    if systemctl list-units &>/dev/null 2>&1; then
      HAS_SYSTEMCTL=true
    else
      HAS_SYSTEMCTL=false
    fi
    ;;
  vps)
    info "Платформа: $(platform_chip VPS)"
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

termux_pkg() {
  if [ "$(id -u)" -eq 0 ] && [ -n "${TERMUX_PKG_USER:-}" ] && [ "$TERMUX_PKG_USER" != "root" ]; then
    su -s /bin/bash "$TERMUX_PKG_USER" -c "export PATH=\"\$PREFIX/bin:\$PATH\"; pkg $(printf '%q ' "$@")"
  else
    pkg "$@"
  fi
}

termux_pkg_update() {
  termux_pkg update -y
  termux_pkg upgrade -y
}

pkg_install() {
  if [ "$PLATFORM" = "termux" ]; then
    termux_pkg install -y "$@"
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
ask "Режим установки"
choice_line 1 "PROD"  "сервер с доменом и SSL (Let's Encrypt)"
choice_line 2 "LOCAL" "локальный тест, self-signed SSL"

if [ "$PLATFORM" = "termux" ]; then
  warn "На Termux PROD недоступен — выбран LOCAL"
  MODE_CHOICE=2
else
  prompt_def MODE_CHOICE 1 "Выбери режим [1/2]"
fi

if [ "$MODE_CHOICE" = "1" ] && [ "$PLATFORM" != "termux" ]; then
  MODE="prod"
  info "Режим: $(mode_chip)"
else
  MODE="local"
  info "Режим: $(mode_chip)"
fi

# ═══════════════════════════════════════════════════════════════
# 2. СБОР ПАРАМЕТРОВ
# ═══════════════════════════════════════════════════════════════
section "Основные настройки"

if [ "$MODE" = "prod" ]; then
  prompt DOMAIN "Домен (например: example.com)"
  [ -z "$DOMAIN" ] && err "Домен обязателен"
  prompt LE_EMAIL "Email для Let's Encrypt"
  [ -z "$LE_EMAIL" ] && err "Email обязателен"
else
  DOMAIN="localhost"
  LE_EMAIL=""
  dim "Домен: localhost (LOCAL)"
fi

if [ "$MODE" = "prod" ]; then
  PREVIEW_APP_URL="https://${DOMAIN}"
else
  PREVIEW_APP_URL="https://localhost"
fi

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
hint "Папка установки → ${CYAN}${APP_DIR}${NC}"

prompt_def API_PORT 3001 "Порт Node.js сервера"

section "PostgreSQL"
prompt_def DB_NAME cicada "Имя БД"
prompt_def DB_USER cicada_user "Пользователь БД"

while true; do
  prompt_secret DB_PASSWORD "Пароль БД (мин. 8 символов)"
  [ ${#DB_PASSWORD} -ge 8 ] && break
  warn "Слишком короткий пароль, минимум 8 символов"
done

section "Безопасность"
if command -v openssl &>/dev/null; then
  ADMIN_KEY=$(openssl rand -hex 32)
else
  ADMIN_KEY=$(head -c 32 /dev/urandom | xxd -p | tr -d '\n')
fi
hint "ADMIN_KEY (авто): ${CYAN}${ADMIN_KEY}${NC}"
prompt_yn USE_ADMIN_KEY y "Использовать этот ADMIN_KEY"
if [ "${USE_ADMIN_KEY,,}" = "n" ]; then
  while true; do
    prompt_secret ADMIN_KEY "Введи свой ADMIN_KEY (мин. 12 символов)"
    [ ${#ADMIN_KEY} -ge 12 ] && break
    warn "ADMIN_KEY должен быть не короче 12 символов"
  done
fi

JWT_SECRET=""
prompt_yn USE_JWT_SECRET y "Автоматически сгенерировать JWT_SECRET"
if [ "${USE_JWT_SECRET,,}" = "n" ]; then
  while true; do
    prompt_secret JWT_SECRET "JWT_SECRET (PROD ≥ 32 символов)"
    if [ "$MODE" = "prod" ]; then
      [ ${#JWT_SECRET} -ge 32 ] && break
      warn "Для PROD минимум 32 символа"
    else
      [ ${#JWT_SECRET} -ge 8 ] && break
      warn "Минимум 8 символов"
    fi
  done
fi

ADMIN_PASSWORD=""
ADMIN_NAME="Admin"
section "Учётная запись (вход в Studio)"
if [ "$MODE" = "local" ]; then
  while true; do
    prompt ADMIN_EMAIL "Email администратора"
    [ -n "$ADMIN_EMAIL" ] && break
    warn "Email обязателен для локального входа"
  done
  prompt_def ADMIN_NAME Admin "Имя в профиле"
  while true; do
    prompt_secret ADMIN_PASSWORD "Пароль для входа (мин. 8 символов)"
    [ ${#ADMIN_PASSWORD} -ge 8 ] || { warn "Минимум 8 символов"; continue; }
    prompt_secret ADMIN_PASSWORD2 "Повторите пароль"
    [ "$ADMIN_PASSWORD" = "$ADMIN_PASSWORD2" ] && break
    warn "Пароли не совпадают"
  done
else
  prompt ADMIN_EMAIL "Email администратора"
fi

section "Telegram"
hint "Enter — пропустить необязательные поля"
prompt TG_BOT_TOKEN "TG_BOT_TOKEN"
prompt TG_BOT_NAME "Имя бота без @"

RESEND_API_KEY=""
EMAIL_FROM="noreply@${DOMAIN}"
CRYPTOBOT_TOKEN=""
GOOGLE_CLIENT_ID=""
GOOGLE_CLIENT_SECRET=""
GOOGLE_CALLBACK_URL="${PREVIEW_APP_URL}/api/auth/google/callback"
GROQ_TOKEN=""
GROQ_TOKEN_2=""
GROQ_TOKEN_3=""
OLLAMA_URL="http://127.0.0.1:11434"
OLLAMA_MODEL="qwen2.5:3b"

if [ "$MODE" = "prod" ]; then
  section "Email (Resend)"
  prompt RESEND_API_KEY "RESEND_API_KEY"
  prompt_def EMAIL_FROM "noreply@${DOMAIN}" "EMAIL_FROM"

  section "CryptoBot"
  prompt CRYPTOBOT_TOKEN "CRYPTOBOT_TOKEN"

  section "Google OAuth"
  prompt GOOGLE_CLIENT_ID "GOOGLE_CLIENT_ID"
  prompt_secret GOOGLE_CLIENT_SECRET "GOOGLE_CLIENT_SECRET"
  prompt_def GOOGLE_CALLBACK_URL "${PREVIEW_APP_URL}/api/auth/google/callback" "GOOGLE_CALLBACK_URL"

  section "Groq API (AI)"
  prompt_secret GROQ_TOKEN "GROQ_TOKEN"
  prompt_secret GROQ_TOKEN_2 "GROQ_TOKEN_2"
  prompt_secret GROQ_TOKEN_3 "GROQ_TOKEN_3"

  section "Ollama (локальный AI)"
  prompt_def OLLAMA_URL "http://127.0.0.1:11434" "OLLAMA_URL"
  prompt_def OLLAMA_MODEL "qwen2.5:3b" "OLLAMA_MODEL"
else
  hint "LOCAL: Resend, CryptoBot, OAuth и Groq пропущены — при необходимости добавь в .env"
fi

section "Доп. защита админки (TOTP)"
prompt_secret ADMIN_TOTP_SECRET "ADMIN_TOTP_SECRET (Enter — пропустить)"

section "ESPHome (/esphome, сборка прошивок)"
INSTALL_ESPHOME=0
ESPHOME_PIN="${ESPHOME_PIN:-}"
if [ "$PLATFORM" = "termux" ]; then
  warn "На Termux ESPHome не ставится автоматически — конструктор есть, compile на сервере нет"
else
  prompt_yn INSTALL_ESPHOME_ANS y "Установить ESPHome в .venv-esphome"
  if [ "${INSTALL_ESPHOME_ANS,,}" != "n" ]; then
    INSTALL_ESPHOME=1
    prompt ESPHOME_PIN_INPUT "Версия esphome на PyPI (Enter = последняя)"
    ESPHOME_PIN_INPUT=$(echo "$ESPHOME_PIN_INPUT" | tr -d '[:space:]')
    if [ -n "$ESPHOME_PIN_INPUT" ]; then
      ESPHOME_PIN="$ESPHOME_PIN_INPUT"
    fi
  fi
fi

# ═══════════════════════════════════════════════════════════════
# 3. ПОДТВЕРЖДЕНИЕ
# ═══════════════════════════════════════════════════════════════
summary_box_begin
summary_row "Платформа" "$PLATFORM" "$TEAL"
if [ "$MODE" = "prod" ]; then
  summary_row "Режим" "$MODE" "$GREEN"
else
  summary_row "Режим" "$MODE" "$ORANGE"
fi
summary_row "Домен" "$DOMAIN" "$CYAN"
summary_row "Папка" "$APP_DIR" "$WHITE"
summary_row "Порт" "$API_PORT" "$CYAN"
summary_row "БД" "${DB_NAME} @ localhost" "$WHITE"
summary_row "DB_USER" "$DB_USER" "$WHITE"
summary_row "ADMIN_EMAIL" "$ADMIN_EMAIL" "$ORANGE"
if [ "$MODE" = "local" ] && [ -n "$ADMIN_PASSWORD" ]; then
  summary_row "Пароль входа" "задан (${#ADMIN_PASSWORD} симв.)" "$GREEN"
fi
if [ "$INSTALL_ESPHOME" = "1" ]; then
  summary_row "ESPHome" "да (.venv-esphome${ESPHOME_PIN:+, ${ESPHOME_PIN}})" "$GREEN"
else
  summary_row "ESPHome" "нет" "$DIM"
fi
summary_box_end
echo ""
prompt_yn CONFIRM y "Всё верно? Начать установку"
[ "${CONFIRM,,}" = "n" ] && err "Установка отменена"

# ═══════════════════════════════════════════════════════════════
# 4. СИСТЕМА И ЗАВИСИМОСТИ
# ═══════════════════════════════════════════════════════════════
INSTALL_TOTAL=12
section "Установка компонентов"
install_phase "Системные пакеты"
info "Обновляем пакеты..."
if [ "$PLATFORM" = "termux" ]; then
  termux_pkg_update && ok "Пакеты Termux обновлены" \
    || err "Не удалось обновить пакеты Termux. Запусти bootstrap не от root или: pkg update && pkg upgrade"
else
  $SUDO apt-get update -qq && $SUDO apt-get upgrade -y -qq
  ok "Пакеты обновлены"
fi

# ─── Базовые утилиты ───────────────────────────────────────────
if [ "$PLATFORM" = "termux" ]; then
  pkg_install curl git openssl-tool
else
  $SUDO apt-get install -y -qq curl git openssl ca-certificates
  [ "$PLATFORM" = "vps" ] && $SUDO apt-get install -y -qq ufw
  # DSL sandbox (bwrap) + зависимости для ESPHome/PlatformIO
  $SUDO apt-get install -y -qq bubblewrap python3-venv python3-dev \
    build-essential pkg-config libffi-dev git 2>/dev/null \
    || $SUDO apt-get install -y -qq bubblewrap python3-venv git build-essential
fi
ok "Базовые утилиты установлены"

install_phase "Python и cicada-studio"
if ! command -v python3 &>/dev/null; then
  info "Устанавливаем Python 3..."
  if [ "$PLATFORM" = "termux" ]; then
    pkg_install python
  else
    $SUDO apt-get install -y -qq python3 python3-pip
  fi
  ok "Python $(python3 --version) установлен"
else
  ok "Python $(python3 --version) уже установлен"
fi

# ─── cicada-studio ─────────────────────────────────────────────────
CICADA_TG_PIN="${CICADA_TG_PIN:-0.0.1}"
info "Устанавливаем cicada-studio==${CICADA_TG_PIN}..."
if [ "$PLATFORM" = "termux" ]; then
  pip install "cicada-studio==${CICADA_TG_PIN}" -q 2>/dev/null
else
  PIP_ROOT_USER_ACTION=ignore pip install "cicada-studio==${CICADA_TG_PIN}" \
    --break-system-packages -q 2>/dev/null
fi
ok "cicada-studio==${CICADA_TG_PIN} установлен"

if command -v cicada &>/dev/null; then
  CICADA_BIN_PATH=$(command -v cicada)
else
  CICADA_BIN_PATH=/usr/local/bin/cicada
  warn "cicada не в PATH — в .env будет CICADA_BIN=$CICADA_BIN_PATH (при необходимости поправь)"
fi

install_phase "Node.js, PM2, PostgreSQL, Nginx"
if ! command -v node &>/dev/null; then
  info "Устанавливаем Node.js 20..."
  if [ "$PLATFORM" = "termux" ]; then
    pkg_install nodejs
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
    pkg_install postgresql
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
  $SUDO systemctl start postgresql &>/dev/null || true
  $SUDO systemctl enable postgresql &>/dev/null || true
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

# ─── ESPHome (venv в каталоге проекта) ─────────────────────────
ESPHOME_BIN_PATH=""
PIO_BIN_PATH=""
if [ "$INSTALL_ESPHOME" = "1" ]; then
  install_phase "ESPHome (.venv-esphome)"
  info "Устанавливаем ESPHome (может занять несколько минут)..."
  hint "${APP_DIR}/.venv-esphome"
  if ! python3 -m venv --help &>/dev/null; then
    if [ "$PLATFORM" != "termux" ]; then
      $SUDO apt-get install -y -qq python3-venv
    fi
  fi
  python3 -m venv "${APP_DIR}/.venv-esphome"
  # shellcheck source=/dev/null
  "${APP_DIR}/.venv-esphome/bin/pip" install --upgrade pip wheel setuptools -q
  if [ -n "$ESPHOME_PIN" ]; then
  "${APP_DIR}/.venv-esphome/bin/pip" install -q "esphome==${ESPHOME_PIN}"
  else
    "${APP_DIR}/.venv-esphome/bin/pip" install -q esphome
  fi
  ESPHOME_BIN_PATH="${APP_DIR}/.venv-esphome/bin/esphome"
  if [ -x "${APP_DIR}/.venv-esphome/bin/pio" ]; then
    PIO_BIN_PATH="${APP_DIR}/.venv-esphome/bin/pio"
  elif [ -x "${APP_DIR}/.venv-esphome/bin/platformio" ]; then
    PIO_BIN_PATH="${APP_DIR}/.venv-esphome/bin/platformio"
  fi
  _esphome_ver=$("$ESPHOME_BIN_PATH" version 2>/dev/null | head -1 || echo 'установлен')
  ok "ESPHome: ${_esphome_ver}"
  if [ -n "$PIO_BIN_PATH" ]; then
    _pio_ver=$("$PIO_BIN_PATH" --version 2>/dev/null | head -1 || echo "$PIO_BIN_PATH")
    ok "PlatformIO: ${_pio_ver}"
  else
    warn "pio не найден в venv — при сборке ESPHome подтянет PlatformIO при первом compile"
  fi
fi

if command -v bwrap &>/dev/null; then
  ok "bubblewrap DSL sandbox: $(command -v bwrap)"
elif [ "$PLATFORM" != "termux" ]; then
  warn "bwrap не найден — DSL sandbox без изоляции, см. DSL_SANDBOX_MODE в .env"
fi

# ═══════════════════════════════════════════════════════════════
# 5. POSTGRESQL — СОЗДАНИЕ БД И ПОЛЬЗОВАТЕЛЯ
# ═══════════════════════════════════════════════════════════════
install_phase "База данных PostgreSQL"
info "Создаём БД и пользователя..."

pgsql_super() {
  if [ "$PLATFORM" = "termux" ]; then
    psql -U "$(whoami)" "$@"
  else
    sudo -u postgres psql "$@"
  fi
}

if ! pgsql_super &>/dev/null << SQL
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
then
  err "Ошибка настройки PostgreSQL"
fi

pgsql_super -d "$DB_NAME" -c "GRANT ALL ON SCHEMA public TO ${DB_USER};" &>/dev/null
ok "БД '${DB_NAME}' и пользователь '${DB_USER}' готовы"

# ═══════════════════════════════════════════════════════════════
# 6. ПРИЛОЖЕНИЕ — ПАПКА И ЗАВИСИМОСТИ
# ═══════════════════════════════════════════════════════════════
install_phase "Приложение и npm"
info "Настраиваем проект..."
hint "$APP_DIR"
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

mkdir -p "$APP_DIR/uploads/media" "$APP_DIR/bots" "$APP_DIR/data/firmware-cache" \
  "$APP_DIR/public/firmware" "$APP_DIR/public/flash/jammer" "$APP_DIR/.cache/platformio" \
  /tmp/esphome-jobs 2>/dev/null || true
ok "Рабочие каталоги (bots/, uploads/, firmware/) созданы"

# Канонический путь к .bin (пишется в .env; publish читает отсюда)
JAMMER_FIRMWARE_BIN="${APP_DIR}/public/firmware/esp8266_deauther.bin"
mkdir -p "$(dirname "$JAMMER_FIRMWARE_BIN")"

JAMMER_SRC=""
for _jammer_candidate in \
  "$JAMMER_FIRMWARE_BIN" \
  "$APP_DIR/esp8266_deauther.bin" \
  "$APP_DIR/public/flash/jammer/esp8266_deauther.bin"; do
  if [ -f "$_jammer_candidate" ]; then
    JAMMER_SRC="$_jammer_candidate"
    break
  fi
done

if [ -f "$APP_DIR/esp8266_deauther.bin" ] && [ ! -f "$JAMMER_FIRMWARE_BIN" ]; then
  cp -f "$APP_DIR/esp8266_deauther.bin" "$JAMMER_FIRMWARE_BIN"
  JAMMER_SRC="$JAMMER_FIRMWARE_BIN"
  ok "Прошивка скопирована в ${JAMMER_FIRMWARE_BIN}"
elif [ -f "$APP_DIR/public/flash/jammer/esp8266_deauther.bin" ] && [ ! -f "$JAMMER_FIRMWARE_BIN" ]; then
  cp -f "$APP_DIR/public/flash/jammer/esp8266_deauther.bin" "$JAMMER_FIRMWARE_BIN"
  JAMMER_SRC="$JAMMER_FIRMWARE_BIN"
  ok "Прошивка скопирована в ${JAMMER_FIRMWARE_BIN}"
fi

if [ -f "$JAMMER_SRC" ]; then
  if cd "$APP_DIR" && JAMMER_FIRMWARE_BIN="$JAMMER_FIRMWARE_BIN" npm run jammer:publish &>/dev/null; then
    ok "Прошивка глушилки: опубликована (источник: $JAMMER_SRC)"
  else
    warn "Прошивка глушилки: файл есть, но npm run jammer:publish не удался"
  fi
else
  warn "Прошивка ESP8266 Deauther: положите esp8266_deauther.bin в:
    ${JAMMER_FIRMWARE_BIN}
  и выполните: npm run jammer:publish"
fi

# ═══════════════════════════════════════════════════════════════
# 7. .ENV ФАЙЛ
# ═══════════════════════════════════════════════════════════════
install_phase "Файл .env"
info "Создаём конфигурацию..."

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
  APP_ENV_VAL="production"
else
  VITE_API_URL="https://localhost/api"
  VITE_API_TARGET="https://localhost"
  APP_URL_VAL="https://localhost"
  APP_ENV_VAL="development"
fi

cat > "$APP_DIR/.env" << ENV
# ─── Server ──────────────────────────────────────────────────
APP_ENV=${APP_ENV_VAL}
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

# ─── DSL Sandbox ─────────────────────────────────────────────
DSL_SANDBOX_MODE=$([ "$APP_ENV_VAL" = "production" ] && echo "enforced" || echo "auto")
DSL_SANDBOX_NETWORK=$([ "$APP_ENV_VAL" = "production" ] && echo "host" || echo "host")
DSL_MAX_RUNTIME_MS=300000
DSL_MAX_CODE_BYTES=100000
DSL_MAX_LOG_CHARS=80000

# ─── ESPHome / прошивки (/esphome, /api/esp/*) ───────────────
ESPHOME_JOBS_ROOT=/tmp/esphome-jobs
ESPHOME_MAX_CONCURRENT_BUILDS=2
FIRMWARE_DOWNLOAD_TTL_MS=300000
ESPHOME_CLEANUP_INTERVAL_MS=300000
FIRMWARE_BUILD_TIMEOUT_MS=1800000
ESPHOME_PLATFORMIO_HOME=${APP_DIR}/.cache/platformio
ESPHOME_PUBLIC_BUILD=0
$(if [ -n "$ESPHOME_BIN_PATH" ]; then echo "ESPHOME_BIN=${ESPHOME_BIN_PATH}"; else echo "# ESPHOME_BIN=${APP_DIR}/.venv-esphome/bin/esphome"; fi)
$(if [ -n "$PIO_BIN_PATH" ]; then echo "PIO_BIN=${PIO_BIN_PATH}"; else echo "# PIO_BIN=${APP_DIR}/.venv-esphome/bin/pio"; fi)
# ESP8266 глушилка (/flash/jammer/): исходный .bin (не в git)
JAMMER_FIRMWARE_BIN=${JAMMER_FIRMWARE_BIN}
ENV

chmod 600 "$APP_DIR/.env"
ok ".env создан (права 600)"

# ═══════════════════════════════════════════════════════════════
# 8. СБОРКА ФРОНТЕНДА
# ═══════════════════════════════════════════════════════════════
if [ -f "$APP_DIR/package.json" ]; then
  install_phase "Сборка фронтенда (Vite)"
  info "npm run build..."
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
  install_phase "Nginx"
  info "Конфигурируем reverse proxy..."
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
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location = /satana.html { return 301 /satana; }

    location /api/ {
        proxy_pass http://localhost:${API_PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
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
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location = /satana.html { return 301 /satana; }

    location /api/ {
        proxy_pass http://localhost:${API_PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
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
install_phase "Запуск сервера (PM2)"
info "Стартуем Node.js..."
cd "$APP_DIR"

pm2 delete server 2>/dev/null || true
pm2 start server.mjs --name server
pm2 save

if $HAS_SYSTEMCTL && [ "$PLATFORM" = "vps" ]; then
  pm2 startup systemd -u root --hp /root &>/dev/null || true
  ok "PM2 autostart настроен (systemd)"
elif [ "$PLATFORM" = "termux" ]; then
  if [ -d "$HOME/.termux/boot" ]; then
    cat > "$HOME/.termux/boot/cicada.sh" << BOOT
#!/data/data/com.termux/files/usr/bin/bash
pg_ctl -D "\$PREFIX/var/lib/postgresql" start
cd "${APP_DIR}" && pm2 resurrect
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

# ─── Локальный админ: учётка + pro ─────────────────────────────
wait_for_users_table() {
  local i
  for i in $(seq 1 45); do
    if pgsql_super -d "$DB_NAME" -tAc \
      "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='users'" \
      2>/dev/null | grep -q 1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

seed_local_admin_account() {
  [ "$MODE" != "local" ] && return 0
  [ -z "$ADMIN_EMAIL" ] || [ -z "$ADMIN_PASSWORD" ] && return 0

  echo ""
  info "Создаём учётную запись для входа ($ADMIN_EMAIL)..."
  wait_for_users_table || {
    warn "Таблица users не появилась — зарегистрируйся в UI или повтори bootstrap"
    return 1
  }

  cd "$APP_DIR"
  if ADMIN_EMAIL="$ADMIN_EMAIL" ADMIN_PASSWORD="$ADMIN_PASSWORD" ADMIN_NAME="${ADMIN_NAME:-Admin}" \
     DB_HOST="localhost" DB_PORT="5432" DB_NAME="$DB_NAME" DB_USER="$DB_USER" DB_PASSWORD="$DB_PASSWORD" \
     node --input-type=module <<'SEED'
import pg from 'pg';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD || '';
const name = (process.env.ADMIN_NAME || 'Admin').trim().slice(0, 64) || 'Admin';
if (!email || password.length < 8) process.exit(2);

const pool = new pg.Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

const hash = bcrypt.hashSync(password, 10);
const exp = 9999999999999;

try {
  const existing = await pool.query('SELECT id FROM users WHERE email=$1', [email]);
  if (existing.rowCount > 0) {
    await pool.query(
      `UPDATE users SET name=$1, password=$2, verified=TRUE, verify_token=NULL, verify_token_exp=NULL,
       plan='pro', role='admin', subscription_exp=$3 WHERE email=$4`,
      [name, hash, exp, email],
    );
  } else {
    await pool.query(
      `INSERT INTO users (id, name, email, password, verified, plan, role, subscription_exp)
       VALUES ($1,$2,$3,$4,TRUE,'pro','admin',$5)`,
      [crypto.randomUUID(), name, email, hash, exp],
    );
  }
} finally {
  await pool.end();
}
SEED
  then
    ok "Вход готов: $ADMIN_EMAIL (email подтверждён, роль admin, план pro)"
  else
    warn "Не удалось создать учётку — проверь pm2 logs server и подключение к БД"
  fi
}

grant_admin_privileges() {
  [ -z "$ADMIN_EMAIL" ] && return 0
  local email_lc
  email_lc=$(echo "$ADMIN_EMAIL" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')
  pgsql_super -d "$DB_NAME" -c \
    "UPDATE users SET plan='pro', role='admin', subscription_exp=9999999999999 WHERE lower(trim(email))='${email_lc}';" \
    &>/dev/null || true
}

if [ "$MODE" = "local" ] && [ -n "$ADMIN_PASSWORD" ]; then
  sleep 2
  seed_local_admin_account
elif [ -n "$ADMIN_EMAIL" ]; then
  echo ""
  info "Выдаём pro-план администратору ($ADMIN_EMAIL)..."
  sleep 3
  grant_admin_privileges \
    && ok "Pro-план и роль admin выданы администратору" \
    || warn "Пользователь ${ADMIN_EMAIL} ещё не зарегистрирован — зайди в аккаунт и затем выполни вручную:
    sudo -u postgres psql -d ${DB_NAME} -c \"UPDATE users SET plan='pro', role='admin', subscription_exp=9999999999999 WHERE email='${ADMIN_EMAIL}';\""
fi

# ═══════════════════════════════════════════════════════════════
# 13. ПРОВЕРКА
# ═══════════════════════════════════════════════════════════════
install_phase "Проверка установки"
info "Финальная диагностика..."
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

if [ -n "$ESPHOME_BIN_PATH" ] && [ -x "$ESPHOME_BIN_PATH" ]; then
  _esphome_cli_ver=$("$ESPHOME_BIN_PATH" version 2>/dev/null | head -1)
  ok "ESPHome CLI: ${_esphome_cli_ver}"
elif [ "$INSTALL_ESPHOME" = "1" ]; then
  warn "ESPHome: бинарник не найден — проверь .venv-esphome"
fi

# ═══════════════════════════════════════════════════════════════
# 14. ИТОГ
# ═══════════════════════════════════════════════════════════════
echo ""
echo -e "${GREEN}  ╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}  ║${NC}${BOLD}${WHITE}              ✔  УСТАНОВКА ЗАВЕРШЕНА                      ${NC}${GREEN}║${NC}"
echo -e "${GREEN}  ╚══════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${BOLD}${CYAN}  ╭─ Доступ ─────────────────────────────────────────────────╮${NC}"

if [ "$MODE" = "prod" ]; then
  summary_row "Сайт" "https://${DOMAIN}" "$GREEN"
  summary_row "Админка" "https://${DOMAIN}/satana" "$ORANGE"
  summary_row "ESPHome" "https://${DOMAIN}/esphome/" "$CYAN"
elif [ "$PLATFORM" = "termux" ]; then
  summary_row "API" "http://127.0.0.1:${API_PORT}" "$GREEN"
  summary_row "Админка" "http://127.0.0.1:${API_PORT}/satana" "$ORANGE"
  if [ "$MODE" = "local" ] && [ -n "$ADMIN_EMAIL" ]; then
    summary_row "Вход" "${ADMIN_EMAIL}" "$WHITE"
  fi
  warn "Открой 127.0.0.1:${API_PORT} (без nginx https://localhost не сработает)"
else
  summary_row "Сайт" "https://localhost" "$GREEN"
  summary_row "Админка" "https://localhost/satana" "$ORANGE"
  summary_row "ESPHome" "https://localhost/esphome/" "$CYAN"
  dim "Предупреждение о сертификате в браузере — норма для LOCAL"
fi

if [ -n "$ESPHOME_BIN_PATH" ]; then
  summary_row "ESPHome CLI" "$ESPHOME_BIN_PATH" "$DIM"
elif [ "$INSTALL_ESPHOME" != "1" ] && [ "$PLATFORM" != "termux" ]; then
  summary_row "ESPHome" "не установлен" "$YELLOW"
fi

if [ -f "${JAMMER_FIRMWARE_BIN}" ] || [ -f "$APP_DIR/public/flash/jammer/esp8266_deauther.bin" ]; then
  summary_row "Глушилка" "/flash/jammer/ OK" "$GREEN"
  dim "$JAMMER_FIRMWARE_BIN"
else
  summary_row "Глушилка" "нет .bin" "$YELLOW"
  dim "$JAMMER_FIRMWARE_BIN"
fi

echo -e "${BOLD}${CYAN}  ╰──────────────────────────────────────────────────────────╯${NC}"
echo ""
echo -e "${BOLD}${MAGENTA}  ╭─ Система ────────────────────────────────────────────────╮${NC}"
summary_row "Платформа" "$PLATFORM" "$TEAL"
summary_row "БД" "${DB_NAME} / ${DB_USER}" "$WHITE"
summary_row "ADMIN_KEY" "$ADMIN_KEY" "$DIM"
if [ "$MODE" = "local" ] && [ -n "$ADMIN_EMAIL" ] && [ -n "$ADMIN_PASSWORD" ]; then
  summary_row "Логин Studio" "$ADMIN_EMAIL" "$ORANGE"
fi
summary_row "Папка" "$APP_DIR" "$CYAN"
echo -e "${BOLD}${MAGENTA}  ╰──────────────────────────────────────────────────────────╯${NC}"
echo ""
echo -e "${BOLD}${WHITE}  Команды:${NC}"
echo -e "    ${TEAL}pm2 logs server${NC}      ${DIM}— логи${NC}"
echo -e "    ${TEAL}pm2 restart server${NC}   ${DIM}— перезапуск${NC}"
if [ "$PLATFORM" != "termux" ]; then
  echo -e "    ${TEAL}nginx -t && sudo systemctl reload nginx${NC}  ${DIM}— nginx${NC}"
fi
if [ "$PLATFORM" = "termux" ]; then
  echo -e "    ${TEAL}psql -U $(whoami) -d ${DB_NAME}${NC}  ${DIM}— консоль БД${NC}"
else
  echo -e "    ${TEAL}sudo -u postgres psql -d ${DB_NAME}${NC}  ${DIM}— консоль БД${NC}"
fi
echo ""
hint ".env → ${CYAN}${APP_DIR}/.env${NC}"
echo ""
