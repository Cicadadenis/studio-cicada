"""
Cicada Runner — связывает парсер, адаптер и исполнитель.

Поддерживает:
  --debug   подробный трейс каждого шага
  --watch   горячая перезагрузка при изменении .ccd файла
  --log     запись логов в файл cicada.log
"""

import os
import sys
import time
import logging
from pathlib import Path

from cicada.parser import Parser
from cicada.executor import Executor, CicadaRuntimeError
from cicada.adapters.telegram import TelegramAdapter


# ── логгер ───────────────────────────────────────────────────────────────────

def setup_logger(log_to_file: bool = False, debug: bool = False) -> logging.Logger:
    logger = logging.getLogger("cicada")
    logger.setLevel(logging.DEBUG if debug else logging.INFO)

    fmt = logging.Formatter("%(asctime)s [%(levelname)s] %(message)s", "%H:%M:%S")

    # консоль
    ch = logging.StreamHandler()
    ch.setFormatter(fmt)
    logger.addHandler(ch)

    # файл
    if log_to_file:
        fh = logging.FileHandler("cicada.log", encoding="utf-8")
        fh.setFormatter(logging.Formatter(
            "%(asctime)s [%(levelname)s] %(message)s", "%Y-%m-%d %H:%M:%S"
        ))
        logger.addHandler(fh)
        logger.info("📝 Логи пишутся в cicada.log")

    return logger


# ── форматирование обновлений для дебага ─────────────────────────────────────

def format_update(u: dict) -> str:
    if "message" in u:
        msg = u["message"]
        chat = msg.get("chat", {})
        user = msg.get("from", {})
        text = msg.get("text", "[media]")
        return f"[{chat.get('id')}] {user.get('first_name', '?')}: {text[:60]}"
    if "callback_query" in u:
        cq = u["callback_query"]
        user = cq.get("from", {})
        return f"[callback] {user.get('first_name', '?')}: {cq.get('data', '')}"
    return str(u)[:100]


# ── загрузка программы ────────────────────────────────────────────────────────

CURRENT_VERSION = "1.0"


def load_program(path: str):
    base_path = os.path.dirname(os.path.abspath(path))
    with open(path, "r", encoding="utf-8") as f:
        source = f.read()

    program = Parser(source, base_path).parse()

    file_version = program.config.get("version")
    if file_version and file_version != CURRENT_VERSION:
        if file_version > CURRENT_VERSION:
            raise Exception(f"Файл требует более новую версию Cicada: {file_version}")
        print(f"[WARN] Версия бота {file_version}, интерпретатор {CURRENT_VERSION}")

    if not program.config.get("token"):
        raise Exception('Добавь строку: бот "TOKEN"  в начало .ccd файла')

    return program


# ── основной цикл ─────────────────────────────────────────────────────────────

def run_file(path: str, debug: bool = False, watch: bool = False, log_to_file: bool = False):
    logger = setup_logger(log_to_file=log_to_file, debug=debug)

    program = load_program(path)
    token   = program.config["token"]
    tg      = TelegramAdapter(token)
    executor = Executor(program, tg)

    if debug:
        logger.debug(f"Загружен файл: {path}")
        logger.debug(f"Хендлеров: {len(program.handlers)}, сценариев: {len(program.scenarios)}, блоков: {len(program.blocks)}")

    # устанавливаем команды меню
    commands = program.config.get("commands")
    if commands:
        try:
            tg.set_my_commands(commands)
            logger.info("[OK] Команды меню установлены")
        except Exception as e:
            logger.warning(f"Не удалось установить команды меню: {e}")

    # ── проверка токена до запуска ────────────────────────────
    logger.info("Проверяю токен...")
    try:
        me = tg.call("getMe", {})
        bot_name = me.get("result", {}).get("username", "?")
        logger.info(f"[OK] Бот @{bot_name} авторизован")
    except Exception as e:
        err_str = str(e)
        if "404" in err_str or "401" in err_str or "Not Found" in err_str or "Unauthorized" in err_str:
            print()
            print("❌ ОШИБКА: Токен бота недействителен или не найден!")
            print("   Укажи правильный токен в строке:  бот \"TOKEN\"")
            print("   Получить токен можно у @BotFather в Telegram")
            print()
        else:
            print(f"❌ Не удалось подключиться к Telegram: {e}")
        return

    print("[START] Cicada бот запущен. Ctrl+C чтобы остановить.")
    if watch:
        print(f"[WATCH] Слежу за изменениями в {path}")

    file_mtime = Path(path).stat().st_mtime if watch else None
    offset = None

    while True:
        # ── горячая перезагрузка ─────────────────────────────────
        if watch:
            try:
                mtime = Path(path).stat().st_mtime
                if mtime != file_mtime:
                    file_mtime = mtime
                    logger.info(f"[RELOAD] Файл изменился, перезагружаю...")
                    try:
                        program  = load_program(path)
                        executor = Executor(program, tg)
                        logger.info("[OK] Перезагрузка успешна")
                    except Exception as e:
                        logger.error(f"[ERR] Ошибка перезагрузки: {e}")
                        # продолжаем со старой версией
            except FileNotFoundError:
                logger.error(f"[ERR] Файл {path} удалён!")

        # ── получаем обновления ───────────────────────────────────
        try:
            updates = tg.get_updates(offset)
        except KeyboardInterrupt:
            raise
        except Exception as e:
            logger.error(f"Ошибка получения обновлений: {e}")
            time.sleep(3)
            continue

        for u in updates.get("result", []):
            offset = u["update_id"] + 1
            if debug:
                logger.debug(f"← {format_update(u)}")
            try:
                executor.handle(u)
            except CicadaRuntimeError as e:
                # человекочитаемая ошибка из нашего кода
                logger.error(f"Ошибка выполнения: {e}")
            except Exception as e:
                logger.error(f"Необработанная ошибка: {e}")
                if debug:
                    import traceback
                    traceback.print_exc()
