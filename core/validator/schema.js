import { lintPlaceholderBotDeclaration } from '../botTokenPlaceholders.mjs';

const ROOT_RULES = [
  { key: 'версия', re: /^версия\s+"[^"]*"\s*$/i, snippet: 'версия "1.0"' },
  { key: 'бот', re: /^бот\s+"[^"]*"\s*$/i, snippet: 'бот "TOKEN"' },
  { key: 'импорт', re: /^импорт\s+"[^"]+"\s*$/i, snippet: 'импорт "module.ccd"' },
  { key: 'команды', re: /^команды:\s*$/i, snippet: 'команды:' },
  { key: 'глобально', re: /^глобально\s+[а-яёa-z_][а-яёa-z0-9_]*\s*=\s*.+$/i, snippet: 'глобально имя = "значение"' },
  { key: 'блок', re: /^блок\s+[а-яёa-z_][а-яёa-z0-9_]*:\s*$/i, snippet: 'блок приветствие:' },
  { key: 'до каждого', re: /^до\s+каждого:\s*$/i, snippet: 'до каждого:' },
  { key: 'после каждого', re: /^после\s+каждого:\s*$/i, snippet: 'после каждого:' },
  { key: 'при старте', re: /^(?:при\s+старте|старт):?\s*$/i, snippet: 'при старте:' },
  // Любой текст / текст «слово» — как в core/parser.py
  {
    key: 'при тексте',
    re: /^при\s+тексте(?:\s+"[^"]+")?\s*:?\s*$/i,
    snippet: 'при тексте:',
  },
  { key: 'при команде', re: /^(?:при\s+команде|команда)\s+"\/?[^"]+"\s*:\s*$/i, snippet: 'при команде "/help":' },
  { key: 'при нажатии', re: /^при\s+нажатии(?:\s+"[^"]+")?\s*:\s*$/i, snippet: 'при нажатии "Кнопка":' },
  { key: 'при фото', re: /^при\s+фото:?\s*$/i, snippet: 'при фото:' },
  { key: 'при документе', re: /^при\s+документе:?\s*$/i, snippet: 'при документе:' },
  { key: 'при голосовом', re: /^при\s+голосовом:?\s*$/i, snippet: 'при голосовом:' },
  { key: 'при стикере', re: /^при\s+стикере:?\s*$/i, snippet: 'при стикере:' },
  { key: 'при контакте', re: /^при\s+контакте:?\s*$/i, snippet: 'при контакте:' },
  { key: 'при геолокации', re: /^при\s+(?:геолокации|локации):?\s*$/i, snippet: 'при геолокации:' },
  { key: 'сценарий', re: /^сценарий\s+[а-яёa-z_][а-яёa-z0-9_]*:\s*$/i, snippet: 'сценарий регистрация:' },
  { key: 'иначе', re: /^иначе:?\s*$/i, snippet: 'иначе:' },
  {
    key: 'если корень',
    re: /^если\s+.+:\s*$/i,
    snippet: 'если текст содержит "фраза":',
  },
];

const INNER_RULES = [
  { key: 'шаг', re: /^шаг\s+[а-яёa-z_][а-яёa-z0-9_]*:\s*$/i, snippet: 'шаг ввод_имени:' },
  // ответ с конкатенацией (+ переменная), см. cicada/parser.py
  { key: 'ответ', re: /^ответ(?:_md)?\s+.+$/i, snippet: 'ответ "Привет!"' },
  { key: 'кнопки', re: /^кнопки(?:\s*$|:|\s+.+)/i, snippet: 'кнопки "Да" "Нет"' },
  // Ряд reply-клавиатуры под «кнопки:» — как в cicada/parser.py и stacksToDsl.js
  { key: 'кнопки-ряд', re: /^\[\s*(?:"[^"]*"\s*,\s*)*"[^"]*"\s*\]\s*$/i, snippet: '["Да","Нет"]' },
  { key: 'кнопка', re: /^кнопка\s+.+/i, snippet: 'кнопка "Текст" -> "callback"' },
  { key: 'inline-кнопки', re: /^inline-кнопки:?\s*$/i, snippet: 'inline-кнопки:' },
  { key: 'меню', re: /^меню\s+"[^"]+"\s*:\s*$/i, snippet: 'меню "Заголовок":' },
  { key: 'переключить', re: /^переключить\s+.+\s*:\s*$/i, snippet: 'переключить текст:' },
  { key: 'ветка', re: /^"[^"]+"\s*:\s*$/i, snippet: '"вариант":' },
  { key: 'проверить_роль', re: /^проверить_роль\s+.+\s*:\s*$/i, snippet: 'проверить_роль роль:' },
  { key: 'если', re: /^если\s+.+:?\s*$/i, snippet: 'если текст == "да":' },
  { key: 'пусть', re: /^пусть\s+[а-яёa-z_][а-яёa-z0-9_]*\s*=\s*[\s\S]*$/i, snippet: 'пусть x = 1' },
  { key: 'запомни', re: /^запомни\s+[а-яёa-z_][а-яёa-z0-9_]*\s*=\s*[\s\S]*$/i, snippet: 'запомни имя = текст' },
  {
    key: 'запомни файл',
    re: /^запомни\s+файл\s*(?:→|->)\s*[а-яёa-z_][а-яёa-z0-9_]*\s*$/i,
    snippet: 'запомни файл → переменная',
  },
  { key: 'спросить', re: /^спросить\s+"[^"]+"\s*(?:→|->)\s*[а-яёa-z_][а-яёa-z0-9_]*\s*$/i, snippet: 'спросить "Имя?" → имя' },
  { key: 'получить', re: /^получить(?:\s+от\s+\S+)?\s+"[^"]+"\s*(?:→|->)\s*[а-яёa-z_][а-яёa-z0-9_]*\s*$/i, snippet: 'получить "ключ" → значение' },
  // Значение после = может быть пустым — так иногда генерирует/stacksToDSL
  { key: 'сохранить', re: /^сохранить(?:_глобально)?\s+"[^"]+"\s*=\s*[\s\S]*$/i, snippet: 'сохранить "ключ" = значение' },
  { key: 'использовать', re: /^использовать\s+[а-яёa-z_][а-яёa-z0-9_]*\s*$/i, snippet: 'использовать главное_меню' },
  { key: 'опрос', re: /^опрос\s+.+/i, snippet: 'опрос "Вопрос?" "Да" "Нет"' },
  { key: 'пауза', re: /^(?:подождать|пауза)\s+\S+.*$/i, snippet: 'подождать 1' },
  { key: 'печатает', re: /^печатает\s+\S+.*$/i, snippet: 'печатает 2с' },
  { key: 'лог', re: /^лог(?:\[[^\]]+\])?\s+"[^"]*"\s*$/i, snippet: 'лог[info] "ok"' },
  { key: 'перейти', re: /^(?:перейти(?:\s+к\s+шаг)?|запустить)\s+.+$/i, snippet: 'перейти "сценарий"' },
  { key: 'стоп', re: /^(?:стоп|вернуть|завершить.*|прервать|продолжить)$/i, snippet: 'стоп' },
  { key: 'вернуть значение', re: /^вернуть\s+.+/i, snippet: 'вернуть значение' },
  { key: 'повторить шаг', re: /^повторить\s+шаг\s*$/i, snippet: 'повторить шаг' },
  { key: 'http', re: /^(?:fetch|fetch_json|http_(?:get|post|patch|put|delete|заголовки)|запрос\s+(?:GET|POST|PUT|PATCH|DELETE)).+$/i, snippet: 'fetch "https://api" → ответ' },
  { key: 'запрос_бд', re: /^запрос_бд\s+"[^"]+"\s*(?:→|->)\s*\S+/i, snippet: 'запрос_бд "select 1" → rows' },
  { key: 'классифицировать', re: /^классифицировать\s+\[[^\]]+\]\s*(?:→|->)\s*\S+/i, snippet: 'классифицировать ["заказ", "помощь"] → намерение' },
  { key: 'событие', re: /^событие\s+"[^"]+".*$/i, snippet: 'событие "opened"' },
  { key: 'оплата', re: /^оплата\s+\S+\s+\S+\s+\S+\s+"[^"]+"\s*$/i, snippet: 'оплата stripe 10 USD "Подписка"' },
  { key: 'рандом', re: /^рандом:?\s*$/i, snippet: 'рандом:' },
  { key: 'стикер', re: /^стикер\s+"[^"]+"\s*$/i, snippet: 'стикер "FILE_ID"' },
  { key: 'фото', re: /^(?:фото|картинка)\s+\S+.*$/i, snippet: 'фото "https://..." "Подпись"' },
  { key: 'голос', re: /^голос\s+\S+.*$/i, snippet: 'голос "https://..."' },
  { key: 'видео', re: /^видео\s+\S+.*$/i, snippet: 'видео "https://..."' },
  { key: 'аудио', re: /^аудио\s+\S+.*$/i, snippet: 'аудио "https://..."' },
  { key: 'документ', re: /^документ\s+\S+.*$/i, snippet: 'документ "https://..."' },
  {
    key: 'отправить файл',
    re: /^отправить\s+файл\s+.+/i,
    snippet: 'отправить файл {переменная}',
  },
  { key: 'контакт', re: /^контакт\s+.+/i, snippet: 'контакт "+123" "Имя"' },
  { key: 'локация', re: /^локация\s+.+/i, snippet: 'локация 55.75 37.62' },
  { key: 'переслать входящее', re: /^переслать\s+(?:фото|текст|документ|голосовое|аудио|стикер)(?:\s+"[^"]*")?\s*$/i, snippet: 'переслать фото' },
  { key: 'inline из бд', re: /^inline(?:-кнопки)?\s+из\s+бд\s+.+/i, snippet: 'inline из бд "категории" текст "name" id "id" callback "category:" назад "⬅️ Назад" → "назад"' },
  { key: 'удалить бд', re: /^удалить\s+"[^"]+"\s*$/i, snippet: 'удалить "ключ"' },
  { key: 'все_ключи', re: /^все_ключи\s*(?:→|->)\s*\S+/i, snippet: 'все_ключи → список' },
  { key: 'вызвать', re: /^вызвать\s+"[^"]+"/i, snippet: 'вызвать "блок" → результат' },
  { key: 'уведомить', re: /^уведомить\s+.+/i, snippet: 'уведомить user: "текст"' },
  { key: 'рассылка', re: /^рассылка\s+.+/i, snippet: 'рассылка всем: "текст"' },
  { key: 'проверить подписку', re: /^проверить\s+подписку\s+.+/i, snippet: 'проверить подписку @ch → var' },
  { key: 'роль', re: /^роль\s+.+/i, snippet: 'роль @ch user → var' },
  { key: 'переслать сообщение', re: /^переслать(?!(?:\s+(?:фото|текст|документ|голосовое|аудио|стикер))\b)(?:\s+сообщение)?\s+.+/i, snippet: 'переслать сообщение user' },
  { key: 'для каждого', re: /^для\s+каждого\s+\S+\s+в\s+.+:\s*$/i, snippet: 'для каждого x в список:' },
  { key: 'пока', re: /^пока\s+.+:\s*$/i, snippet: 'пока условие:' },
  { key: 'повторять', re: /^повторять\s+\d+\s+раз:?\s*$/i, snippet: 'повторять 3 раз:' },
  { key: 'таймаут', re: /^таймаут\s+\S+.*:\s*$/i, snippet: 'таймаут 5 секунд:' },
];

function firstToken(line) {
  return (line.trim().split(/\s+/)[0] || '').toLowerCase();
}

function collectSuggestions(token, scope) {
  const pool = scope === 'root' ? ROOT_RULES : [...ROOT_RULES, ...INNER_RULES];
  const byPrefix = pool.filter((r) => r.key.startsWith(token)).slice(0, 3);
  if (byPrefix.length > 0) return byPrefix.map((r) => r.snippet);
  return pool.slice(0, 3).map((r) => r.snippet);
}

export function lintDSLSchema(code) {
  const diagnostics = [...lintPlaceholderBotDeclaration(code)];
  const lines = String(code || '').replace(/\r\n/g, '\n').split('\n');
  let inCommands = false;
  let commandsIndent = -1;
  /** @type {{ kind: 'random' | 'inlineKb' | 'menu' | 'buttonsMatrix' | 'poll', base: number } | null} */
  let nestedBlock = null;

  lines.forEach((raw, idx) => {
    const lineNo = idx + 1;
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('#')) return;

    const indent = (raw.match(/^[\t ]*/) || [''])[0].replace(/\t/g, '    ').length;
    const isRoot = indent === 0;

    if (isRoot && /^команды:\s*$/i.test(trimmed)) {
      inCommands = true;
      commandsIndent = indent;
      return;
    }

    if (inCommands) {
      if (indent <= commandsIndent) {
        inCommands = false;
      } else {
        const okCommandItem = /^"[^"]+"\s*-\s*"[^"]+"\s*$/i.test(trimmed);
        if (!okCommandItem) {
          diagnostics.push({
            code: 'DSL004',
            severity: 'error',
            line: lineNo,
            message: 'Неверный формат строки в блоке "команды:"',
            help: 'Используй формат: "/help" - "Описание"',
            suggestions: ['"/start" - "Запуск"', '"/help" - "Помощь"'],
          });
        }
        return;
      }
    }

    if (nestedBlock && trimmed && indent <= nestedBlock.base) {
      nestedBlock = null;
    }

    if (nestedBlock && indent > nestedBlock.base) {
      const { kind } = nestedBlock;
      let ok = false;
      if (kind === 'random' && /^"[^"]+"\s*$/.test(trimmed)) ok = true;
      else if (
        (kind === 'inlineKb' || kind === 'buttonsMatrix') &&
        /^\[/.test(trimmed) &&
        /\]\s*$/.test(trimmed)
      )
        ok = true;
      else if (kind === 'menu' && /^\-\s+"[^"]+"\s*$/.test(trimmed)) ok = true;
      else if (kind === 'poll' && /^\-\s+"[^"]+"\s*$/.test(trimmed)) ok = true;
      if (ok) return;
      nestedBlock = null;
    }

    const rules = isRoot ? ROOT_RULES : [...INNER_RULES, ...ROOT_RULES];
    const matched = rules.some((r) => r.re.test(trimmed));
    if (matched) {
      if (/^рандом:?\s*$/i.test(trimmed)) nestedBlock = { kind: 'random', base: indent };
      else if (/^inline-кнопки:?\s*$/i.test(trimmed)) nestedBlock = { kind: 'inlineKb', base: indent };
      else if (/^меню\s+"[^"]+"\s*:\s*$/i.test(trimmed)) nestedBlock = { kind: 'menu', base: indent };
      else if (/^кнопки:\s*$/i.test(trimmed) || /^кнопки\s*$/i.test(trimmed))
        nestedBlock = { kind: 'buttonsMatrix', base: indent };
      // Многострочный опрос из dslCodegen.emitPoll — только заголовок, варианты строками "- ..."
      else if (/^опрос\s+"[^"]+"\s*$/i.test(trimmed)) nestedBlock = { kind: 'poll', base: indent };
      return;
    }

    const token = firstToken(trimmed);
    diagnostics.push({
      code: isRoot ? 'DSL001' : 'DSL003',
      severity: 'error',
      line: lineNo,
      message: isRoot ? 'Неизвестная корневая инструкция DSL' : 'Неизвестная инструкция DSL',
      help: 'Проверь ключевое слово и формат строки.',
      suggestions: collectSuggestions(token, isRoot ? 'root' : 'inner'),
    });
  });

  return diagnostics;
}

export function getDSLAutocompleteHints() {
  return [
    'при старте:',
    'ответ "Привет!"',
    'отправить файл {переменная}',
    'кнопки "Да" "Нет"',
    'если текст == "да":',
    'спросить "Ваше имя?" → имя',
    'перейти "сценарий_1"',
    'сценарий регистрация:',
    'шаг ввод_данных:',
  ];
}

export function formatDSLDiagnostic(diag) {
  const icon = diag.severity === 'error' ? '❌' : '⚠️';
  const rec = (diag.suggestions || []).length ? ` Примеры: ${diag.suggestions.join(' | ')}` : '';
  const help = diag.help ? ` ${diag.help}` : '';
  return `${icon} [${diag.code}] Строка ${diag.line}: ${diag.message}.${help}${rec}`;
}
