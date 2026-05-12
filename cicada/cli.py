import sys

from cicada.runner import run_file, load_program


def _print_help():
    # ANSI color codes
    CYAN = "\033[36m"
    GREEN = "\033[32m"
    YELLOW = "\033[33m"
    BOLD = "\033[1m"
    RESET = "\033[0m"
    DIM = "\033[2m"

    print(f"{CYAN}  ██████╗██╗ ██████╗ █████╗ ██████╗  █████╗   {RESET}")
    print(f"{CYAN} ██╔════╝██║██╔════╝██╔══██╗██╔══██╗██╔══██╗  {RESET}")
    print(f"{CYAN} ██║     ██║██║     ███████║██║  ██║███████║  {RESET}")
    print(f"{CYAN} ██║     ██║██║     ██╔══██║██║  ██║██╔══██║  {RESET}")
    print(f"{CYAN}  ██████╗██║╚██████╗██║  ██║██████╔╝██║  ██║  {RESET}")
    print(f"{DIM}           @ Created: Cicada 3301              {RESET}")
    print(f"{GREEN}     Язык Программирования Cicada v2.0           {RESET}")
    print()

    print(f"{BOLD}{YELLOW}ИСПОЛЬЗОВАНИЕ (Usage){RESET}")
    print(f"  {CYAN}cicada{RESET} {GREEN}[файл.ccd]{RESET} [опции]")
    print()

    print(f"{BOLD}{YELLOW}КОМАНДЫ (Commands){RESET}")
    print(f"  {GREEN}--version{RESET}, {GREEN}-v{RESET}     Показать версию")
    print(f"  {GREEN}--help{RESET}, {GREEN}-h{RESET}        Показать эту справку")
    print(f"  {GREEN}check{RESET} {DIM}<file.ccd>{RESET}  Проверить синтаксис DSL")
    print(f"  {GREEN}preview{RESET}              Прочитать JSON из stdin, один шаг симуляции (stdout JSON)")
    print()

    print(f"{BOLD}{YELLOW}ОПЦИИ (Flags){RESET}")
    print(f"  {CYAN}--debug{RESET}, {CYAN}--dev{RESET}    Подробное логирование каждого шага")
    print(f"  {CYAN}--watch{RESET}, {CYAN}--reload{RESET} Горячая перезагрузка при изменении файла")
    print(f"  {CYAN}--log{RESET}             Записывать логи в файл cicada.log")
    print(f"  {CYAN}--silent{RESET}          Тихий режим (без вывода в консоль)")
    print()

    print(f"{BOLD}{YELLOW}Примеры (Examples){RESET}")
    print(f"  {CYAN}cicada{RESET} {GREEN}echo.ccd{RESET}         {DIM}# Запуск{RESET}")
    print(f"  {CYAN}cicada{RESET} {GREEN}check{RESET} {GREEN}echo.ccd{RESET}  {DIM}# Проверка синтаксиса{RESET}")
    print()


def main():
    args = sys.argv[1:]

    # Подкоманды
    subcommand = None
    if args and args[0] == "check":
        subcommand = "check"
        args = args[1:]
    elif args and args[0] == "preview":
        subcommand = "preview"
        args = args[1:]

    # Обработка глобальных флагов
    if "--version" in args or "-v" in args:
        print("cicada-tg 0.3.5")
        return

    if "--help" in args or "-h" in args:
        _print_help()
        return

    debug = "--debug" in args or "--dev" in args
    watch = "--watch" in args
    log_file = "--log" in args

    flags = {"--debug", "--dev", "--watch", "--log", "--version", "-v", "--help", "-h"}
    files = [a for a in args if a not in flags]

    if subcommand == "preview":
        try:
            from cicada.preview import main as preview_main
            preview_main()
        except Exception as e:
            print(f"[ERR] Ошибка preview: {e}")
            sys.exit(1)
        return

    if not files:
        _print_help()
        return

    path = files[0]
    try:
        if subcommand == "check":
            # Проверяем парсинг/загрузку DSL (без запуска polling и без требования токена).
            load_program(path, require_token=False)
            print(f"[OK] Синтаксис и загрузка DSL успешны: {path}")
            return

        run_file(path, debug=debug, watch=watch, log_to_file=log_file)
    except FileNotFoundError:
        print(f"[ERR] Файл не найден: {path}")
        sys.exit(1)
    except SyntaxError as e:
        print(f"❌ SyntaxError: {e}")
        sys.exit(1)
    except KeyboardInterrupt:
        print("\n[STOP] Бот остановлен")
    except Exception as e:
        print(f"[ERR] Ошибка: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
