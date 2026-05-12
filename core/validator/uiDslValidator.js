import { analyzeDslControlFlow } from './uiFlowAnalysis.js';
import { lintDSLSchema, formatDSLDiagnostic } from './schema.js';
import { INLINE_BLOCK_HEADERS, isRuntimeVar } from '../runtime/rules.js';

export function getLineIndent(rawLine) {
  return (rawLine.replace(/\t/g, '    ').match(/^(\s*)/)?.[1]?.length) ?? 0;
}

export function validateDSL(code, stacks, blockTypes = []) {
  const errors = [];
  const warnings = [];
  const lines = code.split('\n');
  const schemaDiagnostics = lintDSLSchema(code);
  const controlFlow = analyzeDslControlFlow(code);

  schemaDiagnostics.forEach((diag) => {
    const formatted = formatDSLDiagnostic(diag);
    if (diag.severity === 'error') errors.push(formatted);
    else warnings.push(formatted);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // ✅ 1. СИНТАКСИС — структура файла
  // ═══════════════════════════════════════════════════════════════════════
  let hasStart = false;
  let startCount = 0;
  let hasBot   = false;

  lines.forEach((line, i) => {
    const l = line.trim();
    if (!l || l.startsWith('#')) return;

    if (l.startsWith('при старте:') || l === 'при старте' || l.startsWith('старт:') || l === 'старт') {
      hasStart = true;
      startCount++;
    }

    // Токен бота (пустой токен — без отдельной ❌ здесь; одна подсказка через «Исправить»)
    if (l.startsWith('бот')) {
      hasBot = true;
    }

    // Отступы кратны 4 (ядро использует 4-space indent)
    const indent = getLineIndent(line);
    if (indent > 0 && indent % 4 !== 0) {
      warnings.push(`⚠️ Строка ${i+1}: отступ ${indent} пробелов — должно быть кратно 4`);
    }

    // Пустой блок-заголовок: строка заканчивается на «:»
    // и не является инлайн-блоком (рандом:, кнопки:, если: и т.д.)
    if (l.endsWith(':')) {
      const keyword = l.split(/\s/)[0];
      if (!INLINE_BLOCK_HEADERS.has(keyword)) {
        // Ищем следующую непустую непустую строку
        let nextRaw = null;
        for (let j = i + 1; j < lines.length; j++) {
          if (lines[j].trim() && !lines[j].trim().startsWith('#')) {
            nextRaw = lines[j]; break;
          }
        }
        // Пустой — если нет следующей строки или её отступ ≤ текущего (новый корень)
        const currentIndent = getLineIndent(line);
        const nextIndent    = nextRaw !== null ? getLineIndent(nextRaw) : -1;
        if (nextRaw === null || nextIndent <= currentIndent) {
          warnings.push(`⚠️ Строка ${i+1}: блок "${l}" пустой — нет дочерних инструкций`);
        }
      }
    }
  });

  if (!hasStart) errors.push('❌ Нет «при старте» (или устаревшего «старт») — бот не ответит на /start');
  if (startCount > 1) warnings.push(`⚠️ Несколько блоков «Старт» (${startCount} шт.) — ядро выполнит только первый`);
  if (!hasBot)   warnings.push('💡 Токен бота не указан (блок «бот»). Для запуска добавьте: бот "TOKEN"');

  // ═══════════════════════════════════════════════════════════════════════
  // ✅ 2. СЕМАНТИКА — основана на dispatch-таблице executor.py
  // ═══════════════════════════════════════════════════════════════════════

  // Не проверяем UI-порядок ответов/кнопок эвристикой. Рабочие Cicada-сценарии
  // часто делегируют обработчик через `запустить`/`использовать` или собирают UI
  // в другом блоке, а строгая проверка даёт ложные ошибки на валидном DSL.

  // Дублирующиеся callback-триггеры
  // Ядро: при совпадении trigger берёт ПЕРВЫЙ handler и прерывает (break)
  const callbackTriggers = {};
  stacks.forEach(stack => {
    const root = stack.blocks[0];
    if (root?.type === 'callback' && root.props?.label) {
      const label = root.props.label;
      callbackTriggers[label] = (callbackTriggers[label] || 0) + 1;
    }
  });
  Object.entries(callbackTriggers).forEach(([label, count]) => {
    if (count > 1) {
      warnings.push(`⚠️ «При нажатии "${label}"» объявлен ${count} раза — ядро выполнит только первый`);
    }
  });

  // Дублирующиеся команды
  const commandTriggers = {};
  stacks.forEach(stack => {
    const root = stack.blocks[0];
    if (root?.type === 'command' && root.props?.cmd) {
      const cmd = root.props.cmd;
      commandTriggers[cmd] = (commandTriggers[cmd] || 0) + 1;
    }
  });
  Object.entries(commandTriggers).forEach(([cmd, count]) => {
    if (count > 1) {
      warnings.push(`⚠️ Команда "/${cmd}" объявлена ${count} раза — ядро выполнит только первую`);
    }
  });

  // Проверка существования блоков (использовать X → блок X должен быть объявлен)
  const declaredBlocks = new Set(
    stacks
      .filter(s => s.blocks[0]?.type === 'block')
      .map(s => s.blocks[0].props?.name)
      .filter(Boolean)
  );
  stacks.forEach(stack => {
    stack.blocks.forEach(b => {
      if (b.type === 'use' && b.props?.blockname) {
        if (!declaredBlocks.has(b.props.blockname)) {
          errors.push(`❌ «использовать ${b.props.blockname}» — блок с таким именем не объявлен`);
        }
      }
    });
  });

  // Проверка существования сценариев (перейти "X" → сценарий X или команда /X должны быть объявлены)
  const declaredScenarios = new Set(
    stacks
      .filter(s => s.blocks[0]?.type === 'scenario')
      .map(s => s.blocks[0].props?.name)
      .filter(Boolean)
  );
  // Имена шагов внутри сценариев (перейти к шаг X / перейти "X" внутри сценария)
  const declaredSteps = new Set(
    stacks
      .flatMap(s => s.blocks.filter(b => b.type === 'step').map(b => b.props?.name))
      .filter(Boolean)
  );
  // Команды тоже являются валидными целями для «перейти»
  const declaredCommands = new Set(
    stacks
      .filter(s => s.blocks[0]?.type === 'command')
      .map(s => {
        const cmd = s.blocks[0].props?.cmd || '';
        // нормализуем: "/catalog" и "catalog" — одно и то же
        return [cmd, cmd.startsWith('/') ? cmd : `/${cmd}`, cmd.replace(/^\//, '')];
      })
      .flat()
      .filter(Boolean)
  );
  stacks.forEach(stack => {
    stack.blocks.forEach(b => {
      const isGoto = b.type === 'goto';
      const isRun = b.type === 'run';
      const target = isGoto
        ? b.props?.target
        : (b.props?.name || b.props?.scenario || b.props?.target);
      if ((isGoto || isRun) && target) {
        const targetNorm = target.replace(/^\//, '');
        // Валидна цель если: это объявленный сценарий/блок, объявленная команда, шаг внутри сценария, или специальное значение
        // Шаги сценария: проверяем по собранным именам шагов, потом по имени сценария, потом по команде
        const isValid =
          declaredScenarios.has(target) ||
          (isGoto && declaredBlocks.has(target)) ||
          declaredCommands.has(target) ||
          declaredCommands.has(targetNorm) ||
          declaredSteps.has(target) ||   // имя шага внутри сценария
          target === 'повторить';        // повторить шаг — специальный переход
        if (!isValid) {
          const verb = isRun ? 'запустить' : 'перейти';
          errors.push(`❌ «${verb} "${target}"» — сценарий или команда с таким именем не объявлены`);
        }
      }
    });
  });

  // Условия: проверяем что у «если» есть хоть какой-то оператор
  // (соответствует _eval_binop в executor.py: ==, !=, >, <, >=, <=, содержит, начинается_с, и, или, не)
  lines.forEach((line, i) => {
    const l = line.trim();
    if (!l.startsWith('если ')) return;
    const cond = l.replace(/^если\s+/, '').replace(/:$/, '').trim();
    const valid =
      cond.includes('==') || cond.includes('!=') ||
      cond.includes('>=') || cond.includes('<=') ||
      cond.includes('>') || cond.includes('<') ||
      cond.includes(' содержит ') || cond.includes(' начинается_с ') ||
      cond.includes(' или ') || cond.includes(' и ') ||
      cond.startsWith('не ') ||
      cond.includes('(') ||                      // вызов функции: если длина(x) > 0
      /^[а-яёa-zA-Z_][а-яёa-zA-Z_0-9.]*$/.test(cond); // truthy-check переменной
    if (!valid) {
      warnings.push(`⚠️ Строка ${i+1}: условие "${cond}" — нет оператора сравнения`);
    }
  });

  // Переключатель без вариантов
  lines.forEach((line, i) => {
    const l = line.trim();
    if (!l.startsWith('переключить ')) return;
    const hasCase = lines.slice(i + 1, i + 15).some(ln => {
      const t = ln.trim();
      return t.startsWith('"') && t.endsWith(':');
    });
    if (!hasCase) {
      warnings.push(`⚠️ Строка ${i+1}: переключатель без вариантов`);
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // ✅ 3. РАНТАЙМ — соответствует поведению во время выполнения
  // ═══════════════════════════════════════════════════════════════════════

  // Бесконечный цикл: loop без стоп/goto внутри стека
  stacks.forEach(stack => {
    if (!stack.blocks.some(b => b.type === 'loop')) return;
    const hasExit = stack.blocks.some(b => b.type === 'stop' || b.type === 'goto' || b.type === 'use');
    if (!hasExit) {
      warnings.push(`⚠️ Цикл без выхода ("стоп" или "перейти") — возможен бесконечный цикл`);
    }
  });

  // Использование переменных до определения
  // Ядро: _get_var проверяет ctx.vars, ctx._globals, пользователь.*, чат.*
  // Источники определения: запомни, спросить →, получить → var, запрос → var, классифицировать → var
  // сохранить "key" = val — сохраняет в persistent storage; ключ тоже считается доступной переменной
  // (ядро: get_db().get(user_id, key) → используется в {key} шаблонах)
  const definedVars = new Set();

  // Имена сценариев, шагов и блоков — не переменные, добавляем чтобы не было ложных срабатываний
  lines.forEach(line => {
    const l = line.trim();
    const sc = l.match(/^сценарий\s+([а-яёa-zA-Z_][а-яёa-zA-Z_0-9]*)/);
    if (sc) definedVars.add(sc[1]);
    const st = l.match(/^шаг\s+([а-яёa-zA-Z_][а-яёa-zA-Z_0-9]*)/);
    if (st) definedVars.add(st[1]);
    const bl = l.match(/^блок\s+([а-яёa-zA-Z_][а-яёa-zA-Z_0-9]*)/);
    if (bl) definedVars.add(bl[1]);
  });

  // Глобальные переменные (глобально varname = ...)
  lines.forEach(line => {
    const l = line.trim();
    const g = l.match(/^глобально\s+([а-яёa-zA-Z_][а-яёa-zA-Z_0-9]*)\s*=/);
    if (g) definedVars.add(g[1]);
  });

  lines.forEach(line => {
    const l = line.trim();
    const m1 = l.match(/^запомни\s+([а-яёa-zA-Z_][а-яёa-zA-Z_0-9]*)\s*=/);
    if (m1) definedVars.add(m1[1]);
    // → var (спросить, получить, запрос, классифицировать — все используют →)
    const m2 = l.match(/(?:→|->)\s*([а-яёa-zA-Z_][а-яёa-zA-Z_0-9]*)$/);
    if (m2) definedVars.add(m2[1]);
    // сохранить "key" = val — ключ доступен как переменная через persistent storage
    const m3 = l.match(/^сохранить\s+"([^"]+)"/);
    if (m3) definedVars.add(m3[1]);
    // запрос → var, http_get/fetch ... → var
    const m4 = l.match(/^(?:http_\w+|fetch|fetch_json|запрос|вызвать)\s+.*(?:→|->)\s*([а-яёa-zA-Z_][а-яёa-zA-Z_0-9]*)$/);
    if (m4) definedVars.add(m4[1]);
    const m5 = l.match(/^для каждого\s+([а-яёa-zA-Z_][а-яёa-zA-Z_0-9]*)\s+в\s+/);
    if (m5) definedVars.add(m5[1]);
  });

  // Ключевые слова DSL и встроенные функции ядра (executor.py _BUILTIN_FUNCS)
  const DSL_KEYWORDS = new Set([
    'если','иначе','и','или','не','старт','стоп','ответ','кнопки','рандом',
    'запомни','спросить','получить','сохранить','перейти','использовать',
    'глобально','пауза','печатает','фото','аудио','видео','документ','отправить','файл',
    'стикер','контакт','локация','опрос','лог','уведомление','запрос',
    'запрос_бд','классифицировать','проверить_роль','событие','оплата',
    'блок','сценарий','шаг','повторять','пока','для','в','раз','при',
    'ответ_md','ответ_html','ответ_md2','ответ_markdown_v2','все_ключи','сохранить_глобально','от','удалить','http_заголовки',
    'http_get','http_post','http_patch','http_put','http_delete','fetch','fetch_json','json','таймаут',
    'секунд','подождать','вызвать','проверить','подписку','роль','переслать',
    'сообщение','уведомить','рассылка','группе','RUB',
    'нажатии','команда','команде','версия','бот','команды','до','после','каждого','старте',
    'inline', 'true', 'false', 'null', 'истина', 'ложь', 'пусто',
    // уровни логирования
    'info', 'debug', 'error', 'warn', 'warning',
    // HTTP методы
    'GET', 'POST', 'PUT', 'DELETE', 'PATCH',
    // операторы-слова
    'содержит', 'начинается_с',
    // встроенные функции executor.py (_BUILTIN_FUNCS)
    'длина', 'число', 'тип', 'округлить', 'абс', 'мин', 'макс',
    'верхний', 'нижний', 'обрезать', 'разделить', 'соединить',
    'в_число', 'в_строку', 'в_булево',
    'длина_списка', 'добавить', 'содержит_элемент', 'ключи', 'значения',
    // служебные слова DSL
    'символов', 'переключить', 'меню', 'вернуть', 'inline_кнопки',
    'с', 'по', 'из', 'на', 'к', 'завершить',
    // события — словоформы, встречающиеся в триггерах «при X:»
    'документе','фото','голосовом','голосе','стикере','локации','контакте',
    'каждому','входящем','исходящем','ошибке',
  ]);

  // Регекс-граница слова с поддержкой кириллицы: вместо \b используем lookaround
  // (стандартный \b не работает для смешанных Latin+Cyrillic токенов типа qr_сценарий)
  const WORD_START = '(?<![а-яёА-ЯЁa-zA-Z_0-9])';
  const WORD_END   = '(?![а-яёА-ЯЁa-zA-Z_0-9])';
  const TOKEN_RE   = new RegExp(`${WORD_START}([а-яёА-ЯЁa-zA-Z_][а-яёА-ЯЁa-zA-Z_0-9]*)${WORD_END}`, 'g');
  const DOTTED_RE  = new RegExp(`${WORD_START}([а-яёА-ЯЁa-zA-Z_][а-яёА-ЯЁa-zA-Z_0-9]*(?:\\.[а-яёА-ЯЁa-zA-Z_][а-яёА-ЯЁa-zA-Z_0-9]*)+)${WORD_END}`, 'g');

  // DSL-инструкции, аргумент которых — имя сценария/шага/блока, а не переменная
  const REF_INSTR = /^(?:перейти|запустить|использовать|завершить)\s+/;
  // Триггеры событий: «при документе:», «при фото:», «до каждого:», «после каждого:»
  const EVENT_TRIGGER = /^(?:при|до|после)\s+[а-яёА-ЯЁa-zA-Z_][а-яёА-ЯЁa-zA-Z_0-9]*(?:\s+[а-яёА-ЯЁa-zA-Z_][а-яёА-ЯЁa-zA-Z_0-9]*)?\s*:?\s*$/;

  const usedVarSet = new Set();
  lines.forEach(line => {
    const l = line.trim();

    // Пропускаем строки где аргумент — ссылка на сценарий/шаг/блок
    if (REF_INSTR.test(l)) return;
    // Пропускаем строки-триггеры событий: «при документе:», «при фото:», «до каждого:»
    if (EVENT_TRIGGER.test(l)) return;
    if (/^(?:оплата|уведомить|рассылка|переслать(?:\s+сообщение)?|проверить подписку|роль @)\s+/.test(l)) return;

    // Переменные в шаблонах {var} — пропускаем вызовы функций {func(args)}
    const tmplMatches = [...l.matchAll(/\{([а-яёА-ЯЁa-zA-Z_][а-яёА-ЯЁa-zA-Z_0-9.]*)\}/g)];
    tmplMatches.forEach(m => {
      if (!m[0].includes('(')) usedVarSet.add(m[1]);
    });

    // Переменные в выражениях
    const exprParts = l
      .replace(/лог\[[^\]]*\]/g, 'лог')                                   // лог[info] → лог
      .replace(/[а-яёА-ЯЁa-zA-Z_][а-яёА-ЯЁa-zA-Z_0-9]*\s*\([^)]*\)/g, '') // убираем func(...)
      // Убираем строковые литералы в разных кавычках, чтобы "Париж"/«Париж» не считались переменными
      .replace(/"[^"\n]*"|'[^'\n]*'|«[^»\n]*»|“[^”\n]*”/g, '')
      .replace(/@[^\s]+/g, '')                                             // убираем @channel/usernames
      .replace(/#.*/g, '');                                                // убираем комментарии

    // Сначала точечные токены (объект.поле) как единый блок
    const dottedMatches = [...exprParts.matchAll(DOTTED_RE)];
    dottedMatches.forEach(m => usedVarSet.add(m[1]));
    const exprNoDotted = exprParts.replace(DOTTED_RE, ' ');

    const wordMatches = [...exprNoDotted.matchAll(TOKEN_RE)];
    wordMatches.forEach(m => {
      const name = m[1];
      if (name === '_' || name.length === 1) return;
      if (DSL_KEYWORDS.has(name)) return;
      usedVarSet.add(name);
    });
  });

  usedVarSet.forEach(name => {
    if (isRuntimeVar(name)) return;           // автоматические переменные ядра
    if (definedVars.has(name)) return;        // определена явно
    if (/^\d/.test(name)) return;             // число
    if (name.includes('.')) {
      // var.field — проверяем базовую часть
      const base = name.split('.')[0];
      if (isRuntimeVar(base) || definedVars.has(base)) return;
    }
    warnings.push(`⚠️ Переменная "${name}" используется, но нигде не определена`);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // ✅ 4. Автоисправления (стрелки -> → →, и т.д.)
  // Собираем их для кнопки «Исправить», но не показываем как warning.
  // ═══════════════════════════════════════════════════════════════════════
  return {
    errors,
    warnings,
    hasStart,
    hasBot,
    schemaDiagnostics,
    controlFlow,
  };
}
