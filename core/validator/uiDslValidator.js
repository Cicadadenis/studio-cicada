import { collectDSLFixes } from './fixes.js';
import { lintDSLSchema, formatDSLDiagnostic } from './schema.js';
import {
  DELEGATE_BLOCK_TYPES,
  HANDLER_ROOT_TYPES,
  INLINE_BLOCK_HEADERS,
  OUTPUT_BLOCK_TYPES,
  isRuntimeVar,
} from '../runtime/rules.js';

/** В JS `\b` не работает для кириллицы (только ASCII [A-Za-z0-9_]). */
const CY_END = '(?![а-яёА-ЯЁa-zA-Z_0-9])';

function getBlockDef(type, blockTypes = []) {
  return (blockTypes || []).find((b) => b.type === type);
}

function parseDslBodies(code) {
  const lines = code.split('\n');
  const root = { indent: -1, text: '__root__', children: [], line: 0 };
  const stack = [root];
  lines.forEach((raw, idx) => {
    const text = raw.trim();
    if (!text || text.startsWith('#')) return;
    const indent = getLineIndent(raw);
    const node = { indent, text, children: [], line: idx + 1 };
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) stack.pop();
    stack[stack.length - 1].children.push(node);
    if (text.endsWith(':')) stack.push(node);
  });
  return root;
}

function analyzeBodyUiState(nodes, errors, ctx = { scope: 'body' }) {
  const state = { messages: [], buttons: null, terminal: false, next: null };
  let seenButtons = false;

  const isMessage = (t) => /^(?:ответ|ответ_md)\s+/i.test(t) || t === 'рандом:' || t === 'рандом';
  const isButtons = (t) => /^кнопки(?:\s|:|$)/i.test(t) || /^inline-кнопки:?\s*$/i.test(t);
  const isStop = (t) =>
    new RegExp(`^(?:стоп|завершить\\s+сценарий|завершить|вернуть)${CY_END}`, 'i').test(t);
  const isIf = (t) => new RegExp(`^если${CY_END}`, 'i').test(t);
  const isElse = (t) => new RegExp(`^иначе${CY_END}`, 'i').test(t);
  /** Не новый «Ответ»/спросить, но допустимо после клавиатуры (как в AI few-shot: callback → run). */
  const allowedAfterButtons = (t) =>
    isStop(t) ||
    new RegExp(`^перейти${CY_END}`, 'i').test(t) ||
    new RegExp(`^запустить${CY_END}`, 'i').test(t) ||
    new RegExp(`^использовать${CY_END}`, 'i').test(t) ||
    isElse(t) ||
    new RegExp(`^(?:пауза|подождать|печатает)${CY_END}`, 'i').test(t) ||
    new RegExp(`^лог${CY_END}`, 'i').test(t) ||
    /^пусть\s+/i.test(t) ||
    /^запомни\s+/i.test(t) ||
    new RegExp(`^отправить\\s+файл${CY_END}`, 'i').test(t);

  const mergeBranchUi = (baseState, ifState, elseState, line) => {
    const out = { ...baseState };
    out.messages = [...baseState.messages, ...ifState.messages];
    if (elseState?.messages?.length) out.messages.push(...elseState.messages);

    const ifButtons = ifState.buttons ? JSON.stringify(ifState.buttons) : null;
    const elseButtons = elseState?.buttons ? JSON.stringify(elseState.buttons) : null;
    if (ifButtons !== elseButtons) {
      errors.push(`❌ Строка ${line}: UI_STATE_INVALID: расхождение кнопок в if/else (ветки должны формировать одинаковый финальный UI state)`);
    }
    out.buttons = ifState.buttons || elseState?.buttons || out.buttons || null;
    out.terminal = Boolean(ifState.terminal && (elseState ? elseState.terminal : true));
    out.next = null;
    return out;
  };

  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    const t = node.text;

    if (isMessage(t)) {
      if (seenButtons) errors.push(`❌ Строка ${node.line}: UI_STATE_INVALID: блок «Ответ» не может идти после блока «Кнопки»`);
      state.messages.push(t);
      continue;
    }
    if (isButtons(t)) {
      if (seenButtons || state.buttons) errors.push(`❌ Строка ${node.line}: UI_STATE_INVALID: в одном body допускается только один блок «Кнопки»`);
      if (state.messages.length === 0) errors.push(`❌ Строка ${node.line}: UI_STATE_INVALID: «Кнопки» должны идти после блока «Ответ»`);
      seenButtons = true;
      state.buttons = [t];
      continue;
    }
    if (isStop(t)) {
      state.terminal = true;
      continue;
    }
    if (isIf(t)) {
      const ifState = analyzeBodyUiState(node.children || [], errors, { scope: 'if' });
      let elseState = null;
      if (nodes[i + 1] && isElse(nodes[i + 1].text)) {
        elseState = analyzeBodyUiState(nodes[i + 1].children || [], errors, { scope: 'else' });
        i += 1;
      }
      const merged = mergeBranchUi(state, ifState, elseState, node.line);
      state.messages = merged.messages;
      state.buttons = merged.buttons;
      state.terminal = merged.terminal;
      seenButtons = Boolean(state.buttons);
      continue;
    }
    if (seenButtons && !allowedAfterButtons(t)) {
      errors.push(
        `❌ Строка ${node.line}: UI_STATE_INVALID: instruction after buttons block is not allowed (допустимы «стоп», «перейти»/«запустить», «использовать», пауза/печатает/лог, «запомни»/«пусть», «отправить файл», «иначе» или ветвление «если»)`,
      );
      continue;
    }
  }

  const isClickScope = /^при\s+нажатии\s+/i.test(String(ctx.scope || '').trim());
  if (isClickScope && state.messages.length === 0 && !state.buttons) {
    errors.push(
      `❌ ${ctx.scope}: UI_STATE_INVALID: обработчик нажатия не формирует UI (нет «ответ» и «кнопки»)`,
    );
  }

  return state;
}

export function getLineIndent(rawLine) {
  return (rawLine.replace(/\t/g, '    ').match(/^(\s*)/)?.[1]?.length) ?? 0;
}

export function validateDSL(code, stacks, blockTypes = []) {
  const errors = [];
  const warnings = [];
  const lines = code.split('\n');
  const schemaDiagnostics = lintDSLSchema(code);

  schemaDiagnostics.forEach((diag) => {
    const formatted = formatDSLDiagnostic(diag);
    if (diag.severity === 'error') errors.push(formatted);
    else warnings.push(formatted);
  });

  // AST-like нормализация UI-состояния по телам (через дерево по отступам):
  // messages[], buttons[], terminal + детерминированное слияние if/else.
  const dslTree = parseDslBodies(code);
  dslTree.children.forEach((rootNode) => {
    if (rootNode.children?.length) {
      analyzeBodyUiState(rootNode.children, errors, { scope: rootNode.text });
    }
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

  // Блоки-корни без вывода
  // Ядро: _handle_message → _exec_body → _flush → если ничего не накопилось, молчит
  stacks.forEach(stack => {
    const root = stack.blocks[0];
    if (!root || !HANDLER_ROOT_TYPES.has(root.type)) return;

    const hasOutput   = stack.blocks.some(b => OUTPUT_BLOCK_TYPES.has(b.type));
    const hasDelegate = stack.blocks.some(b => DELEGATE_BLOCK_TYPES.has(b.type));
    // condition/else могут содержать вывод внутри — это нормально, не предупреждаем
    const hasCondition = stack.blocks.some(b => b.type === 'condition' || b.type === 'else' || b.type === 'switch');

    if (!hasOutput && !hasDelegate && !hasCondition) {
      const label = getBlockDef(root.type, blockTypes)?.label || root.type;
      warnings.push(`⚠️ Блок "${label}" («${root.props?.label || root.props?.cmd || ''}») не отправляет ответ пользователю`);
    }
  });

  // Клавиатуры должны присоединяться к накопленному тексту сообщения.
  // После вложенных body (if/else/step) executor делает flush и очищает pending-message,
  // поэтому «кнопки»/«inline-кнопки» должны иметь «ответ» в той же линейной части
  // текущего обработчика/шага, а не только внутри вложенного условия.
  const pendingTextByIndent = new Map();
  const bodyStateByIndent = new Map();
  lines.forEach((line, i) => {
    const l = line.trim();
    if (!l || l.startsWith('#')) return;

    const indent = getLineIndent(line);
    for (const key of [...pendingTextByIndent.keys()]) {
      if (key > indent) pendingTextByIndent.delete(key);
    }
    for (const key of [...bodyStateByIndent.keys()]) {
      if (key >= indent) bodyStateByIndent.delete(key);
    }

    const parentIndent = indent - 4;
    if (parentIndent >= 0 && !bodyStateByIndent.has(parentIndent)) {
      bodyStateByIndent.set(parentIndent, { messageCount: 0, buttonsCount: 0, seenButtons: false, afterButtonsOnlyStop: false });
    }

    const state = parentIndent >= 0 ? bodyStateByIndent.get(parentIndent) : null;

    const isKeyboard = /^кнопки(?:\s|:|$)/i.test(l) || /^inline-кнопки:?\s*$/i.test(l);
    if (isKeyboard && !pendingTextByIndent.get(indent)) {
      const label = l.startsWith('inline-кнопки') ? 'Inline-кнопки' : 'Кнопки';
      errors.push(`❌ Строка ${i+1}: блок «${label}» должен идти после блока «Ответ» в том же шаге/обработчике`);
    }
    if (isKeyboard && state) {
      state.buttonsCount += 1;
      if (state.buttonsCount > 1) {
        errors.push(`❌ Строка ${i+1}: в одном шаге/обработчике допускается только один блок «Кнопки»`);
      }
      if (state.messageCount === 0) {
        errors.push(`❌ Строка ${i+1}: «Кнопки» должны идти после одного или нескольких блоков «Ответ»`);
      }
      state.seenButtons = true;
      state.afterButtonsOnlyStop = true;
    } else if (state?.afterButtonsOnlyStop) {
      const allowedAfterKb =
        new RegExp(`^(?:стоп|завершить\\s+сценарий|завершить|вернуть)${CY_END}`, 'i').test(l) ||
        new RegExp(`^перейти${CY_END}`, 'i').test(l) ||
        new RegExp(`^запустить${CY_END}`, 'i').test(l) ||
        new RegExp(`^использовать${CY_END}`, 'i').test(l) ||
        new RegExp(`^иначе${CY_END}`, 'i').test(l) ||
        new RegExp(`^(?:пауза|подождать|печатает)${CY_END}`, 'i').test(l) ||
        new RegExp(`^лог${CY_END}`, 'i').test(l) ||
        /^пусть\s+/i.test(l) ||
        /^запомни\s+/i.test(l) ||
        new RegExp(`^отправить\\s+файл${CY_END}`, 'i').test(l) ||
        new RegExp(`^если${CY_END}`, 'i').test(l);
      if (!allowedAfterKb) {
        errors.push(
          `❌ Строка ${i + 1}: после блока «Кнопки» недопустимая инструкция (допустимы «стоп», «перейти»/«запустить», «использовать», пауза/печатает/лог, «запомни»/«пусть», «отправить файл», «если»/«иначе»)`,
        );
      } else {
        const clearsAfterKbContext =
          new RegExp(`^(?:стоп|завершить\\s+сценарий|завершить|вернуть)${CY_END}`, 'i').test(l) ||
          new RegExp(`^перейти${CY_END}`, 'i').test(l) ||
          new RegExp(`^запустить${CY_END}`, 'i').test(l) ||
          new RegExp(`^использовать${CY_END}`, 'i').test(l) ||
          new RegExp(`^если${CY_END}`, 'i').test(l) ||
          new RegExp(`^иначе${CY_END}`, 'i').test(l);
        if (clearsAfterKbContext) {
          state.afterButtonsOnlyStop = false;
        }
      }
    }

    if (
      /^(?:ответ|ответ_md)\s+/i.test(l) ||
      l === 'рандом:' ||
      l === 'рандом' ||
      /^отправить\s+файл\s+/i.test(l)
    ) {
      if (state?.seenButtons) {
        errors.push(`❌ Строка ${i+1}: блок «Ответ» не может идти после блока «Кнопки»`);
      } else if (state) {
        state.messageCount += 1;
      }
      pendingTextByIndent.set(indent, true);
      return;
    }

    if (
      new RegExp(`^(?:при|сценарий|шаг|блок|если|иначе|переключить)${CY_END}`, 'i').test(l) ||
      new RegExp(
        `^(?:спросить|фото|видео|аудио|документ|стикер|контакт|локация|опрос|стоп|перейти|запустить|использовать)${CY_END}`,
        'i',
      ).test(l)
    ) {
      pendingTextByIndent.set(indent, false);
    }
  });

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
        // Валидна цель если: это объявленный сценарий, объявленная команда, шаг внутри сценария, или специальное значение
        // Шаги сценария: проверяем по собранным именам шагов, потом по имени сценария, потом по команде
        const isValid =
          declaredScenarios.has(target) ||
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
    'ответ_md','все_ключи','сохранить_глобально','от','удалить','http_заголовки',
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
  // ═══════════════════════════════════════════════════════════════════════
  const lint = collectDSLFixes(code);
  if (lint.fixes.length > 0) {
    warnings.push(
      `⚠️ Найдено ${lint.fixes.length} автоисправлений (стрелки «->» → «→», reply-кнопки «|» → запятые в .ccd). Нажмите «Применить исправления».`,
    );
  }

  return {
    errors,
    warnings,
    hasStart,
    hasBot,
    schemaDiagnostics,
    fixes: lint.fixes,
    correctedCode: lint.correctedCode,
    changedLineIndexes: lint.changedLines,
  };
}
