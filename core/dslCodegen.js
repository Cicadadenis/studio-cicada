/**
 * Ядро генерации DSL (единый вывод для стеков редактора и графа Flow).
 *
 * Модель: Block IR { type, props } → emitBlock() → строки DSL.
 * - Стеки: stackToDSL / generateDSLFromStacks
 * - Граф:  nodeDSL / generateDSLFromFlow
 */

const SCOPE_OPENERS = new Set(['condition', 'else', 'loop', 'step']);

/** Единая точка вывода одного блока (как в IR редактора). */
export function emitBlock(block, indent) {
  const pad = '    '.repeat(indent);
  const p = block.props || {};

  switch (block.type) {
    case 'start':
      return `${pad}при старте:`;
    case 'on_photo':
    case 'photo_received':
      return `${pad}при фото:`;
    case 'on_voice':
    case 'voice_received':
      return `${pad}при голосовом:`;
    case 'on_document':
    case 'document_received':
      return `${pad}при документе:`;
    case 'on_sticker':
    case 'sticker_received':
      return `${pad}при стикере:`;
    case 'on_location':
    case 'location_received':
      return `${pad}при геолокации:`;
    case 'on_contact':
    case 'contact_received':
      return `${pad}при контакте:`;
    case 'on_text': {
      const cond = p.cond ? p.cond : 'текст != ""';
      return `${pad}если ${cond}:`;
    }
    case 'command':
      return `${pad}при команде "/${(p.cmd || 'start').replace(/^\//, '')}":`;
    case 'callback': {
      const tail = p.return === 'true' || p.return === true ? `\n${pad}    вернуть` : '';
      return `${pad}при нажатии "${p.label || 'Кнопка'}":${tail}`;
    }
    case 'block': {
      const tail = p.return === 'true' || p.return === true ? `\n${pad}    вернуть` : '';
      return `${pad}блок ${p.name || 'block'}:${tail}`;
    }
    case 'scenario':
      return `${pad}сценарий ${p.name || 'scenario'}:`;
    case 'middleware': {
      const head =
        p.type === 'before' ? `${pad}до каждого:` : `${pad}после каждого:`;
      const tail = p.return === 'true' || p.return === true ? `\n${pad}    вернуть` : '';
      return head + tail;
    }

    case 'loop':
      if (p.mode === 'foreach')
        return `${pad}для каждого ${p.var || 'элемент'} в ${p.collection || 'список'}:`;
      if (p.mode === 'timeout')
        return `${pad}таймаут ${p.seconds || '5'} секунд:`;
      if (p.mode === 'while')
        return `${pad}пока ${p.cond || 'счёт > 0'}:`;
      return `${pad}повторять ${p.count || '3'} раз:`;

    case 'step':
      return `${pad}шаг ${p.name || 'шаг1'}:`;

    case 'version':
      return `${pad}версия "${p.version || '1.0'}"`;
    case 'bot':
      return `${pad}бот "${p.token || ''}"`;
    case 'global':
      return `${pad}глобально ${p.varname || 'var'} = ${p.value || 'val'}`;
    case 'commands': {
      const lines = (p.commands || '').trim().split('\n').filter(Boolean);
      if (!lines.length) return `${pad}команды:`;
      const formatted = lines.map((l) => {
        const raw = l.trim();
        if (raw.startsWith('"')) return `${pad}    ${raw}`;
        const sep = raw.indexOf(' - ');
        if (sep !== -1) {
          const cmd = raw.slice(0, sep).trim().replace(/^\//, '/');
          const desc = raw.slice(sep + 3).trim();
          return `${pad}    "/${cmd.replace(/^\//, '')}" - "${desc}"`;
        }
        return `${pad}    "/${raw.replace(/^\//, '')}"`;
      });
      return `${pad}команды:\n${formatted.join('\n')}`;
    }

    case 'message':
      return `${pad}ответ "${(p.text || '').replace(/\n/g, '\\n')}"`;
    case 'buttons': {
      const rows = (p.rows || 'Кнопка 1, Кнопка 2').trim().split('\n');
      if (rows.length === 1) {
        const btns = rows[0].split(',').map((b) => `"${b.trim()}"`).join(' ');
        return `${pad}кнопки ${btns}`;
      }
      const matrix = rows.map((r) => {
        const btns = r.split(',').map((b) => `"${b.trim()}"`).join(', ');
        return `${pad}    [${btns}]`;
      }).join('\n');
      return `${pad}кнопки:\n${matrix}`;
    }
    case 'inline': {
      const rows = (p.buttons || 'Да|cb_yes, Нет|cb_no').trim().split('\n');
      const matrix = rows.map((r) => {
        const btns = r.split(',').map((b) => {
          const [text, cb] = b.trim().split('|');
          return `"${(text || '').trim()}" → "${(cb || '').trim()}"`;
        }).join(', ');
        return `${pad}    [${btns}]`;
      }).join('\n');
      return `${pad}inline-кнопки:\n${matrix}`;
    }
    case 'menu': {
      const items = (p.items || 'Пункт 1\nПункт 2').split('\n').filter(Boolean);
      const rows = items.map((it) => `${pad}    ["${it.trim()}"]`).join('\n');
      if (p.title) {
        return `${pad}ответ "${p.title}"\n${pad}кнопки:\n${rows}`;
      }
      return `${pad}кнопки:\n${rows}`;
    }
    case 'condition':
      return `${pad}если ${p.cond || 'текст == \"да\"'}:`;
    case 'else':
      return `${pad}иначе:`;

    case 'switch': {
      const cases = (p.cases || 'да\nнет').split('\n').filter(Boolean);
      const caseLines = cases
        .map((c) => `${pad}    "${c.trim()}":\n${pad}        ответ "..."`)
        .join('\n');
      return `${pad}переключить ${p.varname || 'текст'}:\n${caseLines}`;
    }

    case 'ask':
      return `${pad}спросить "${p.question || '?'}" → ${p.varname || 'имя'}`;
    case 'remember': {
      const remVal = (p.value || '0').replace(/\\n/g, '\\n');
      return `${pad}запомни ${p.varname || 'var'} = ${remVal}`;
    }
    case 'get':
      return `${pad}получить "${p.key || 'key'}" → ${p.varname || 'var'}`;
    case 'save':
      return `${pad}сохранить "${p.key || 'key'}" = ${p.value || 'val'}`;
    case 'random': {
      const variants = (p.variants || 'Привет!\nЗдорово!').split('\n').filter(Boolean);
      const lines = variants.map((v) => `${pad}    "${v.trim()}"`).join('\n');
      return `${pad}рандом:\n${lines}`;
    }
    case 'photo':
      if (p.caption) {
        return `${pad}фото "${p.url || ''}"\n${pad}ответ "${p.caption}"`;
      }
      return `${pad}фото "${p.url || p.file_id || ''}"`;
    case 'video':
      return `${pad}видео "${p.url || ''}"${p.caption ? ` "${p.caption}"` : ''}`;
    case 'audio':
      return `${pad}аудио "${p.url || ''}"`;
    case 'document': {
      const url = p.url || '';
      const extra = p.caption || p.filename || '';
      return extra
        ? `${pad}документ "${url}" "${extra}"`
        : `${pad}документ "${url}"`;
    }
    case 'sticker':
      return `${pad}стикер "${p.file_id || 'FILE_ID'}"`;
    case 'contact': {
      const name = [p.first_name || '', p.last_name || ''].filter(Boolean).join(' ') || p.first_name || '';
      return `${pad}контакт "${p.phone || ''}" "${name}"`;
    }
    case 'location':
      return `${pad}локация ${p.lat || '0'} ${p.lon || '0'}`;
    case 'poll': {
      const opts = (p.options || 'Вариант 1\nВариант 2').split('\n').filter(Boolean);
      const optStr = opts.map((o) => `"${o.trim()}"`).join(' ');
      return `${pad}опрос "${p.question || 'Ваш выбор?'}" ${optStr}`;
    }
    case 'pause':
    case 'delay':
      return `${pad}пауза ${p.seconds || '2'}с`;
    case 'typing':
      return `${pad}печатает ${p.seconds || '1'}с`;

    case 'http': {
      const method = (p.method || 'GET').toUpperCase();
      const url = p.url || '';
      const varname = p.varname || 'результат';
      if (method === 'HEADERS') return `${pad}http_заголовки ${varname}`;
      if (method === 'GET') return `${pad}http_get "${url}" → ${varname}`;
      if (method === 'DELETE') return `${pad}http_delete "${url}" → ${varname}`;
      const m = method.toLowerCase();
      if (p.isJson === 'true' || p.isJson === true)
        return `${pad}http_${m} "${url}" json ${p.jsonVar || varname} → ${varname}`;
      if (p.body) return `${pad}http_${m} "${url}" с "${p.body}" → ${varname}`;
      return `${pad}http_${m} "${url}" → ${varname}`;
    }

    case 'run':
      return `${pad}запустить ${p.name || 'сценарий'}`;
    case 'goto':
      return `${pad}перейти "${p.target || p.label || ''}"`;
    case 'stop':
      if (p.reason === 'break') return `${pad}прервать`;
      if (p.reason === 'continue') return `${pad}продолжить`;
      if (p.reason === 'return' && p.value) return `${pad}вернуть ${p.value}`;
      if (p.reason === 'return') return `${pad}вернуть`;
      return `${pad}стоп`;

    case 'log':
      return `${pad}лог[${p.level || 'info'}] "${p.message || ''}"`;
    case 'notify':
      return `${pad}уведомить ${p.target || 'USER_ID'}: "${(p.text || '').replace(/\n/g, '\\n')}"`;
    case 'broadcast':
      return p.mode === 'group'
        ? `${pad}рассылка группе ${p.tag || 'tag'}: "${(p.text || '').replace(/\n/g, '\\n')}"`
        : `${pad}рассылка всем: "${(p.text || '').replace(/\n/g, '\\n')}"`;
    case 'check_sub':
      return `${pad}проверить подписку ${p.channel || '@channel'} → ${p.varname || 'подписан'}`;
    case 'member_role':
      return `${pad}роль ${p.channel || '@channel'} ${p.user_id || 'пользователь.id'} → ${p.varname || 'роль'}`;
    case 'forward_msg':
      return `${pad}переслать сообщение ${p.target || 'ADMIN_ID'}`;
    case 'db_delete':
      return `${pad}удалить "${p.key || 'ключ'}"`;
    case 'save_global':
      return `${pad}сохранить_глобально "${p.key || 'key'}" = ${p.value || 'значение'}`;
    case 'get_user':
      return `${pad}получить от ${p.user_id || 'target_id'} "${p.key || 'ключ'}" → ${p.varname || 'значение'}`;
    case 'all_keys':
      return `${pad}все_ключи → ${p.varname || 'ключи'}`;
    case 'call_block':
      return `${pad}вызвать "${p.blockname || 'мой_блок'}" → ${p.varname || 'результат'}`;
    case 'database':
      return `${pad}запрос_бд "${p.query || ''}" → ${p.varname || 'результат'}`;
    case 'payment':
      return `${pad}оплата ${p.provider || 'stripe'} ${p.amount || '1'} ${p.currency || 'USD'} "${p.title || 'Оплата'}"`;
    case 'analytics':
      return `${pad}событие "${p.event || ''}"${p.params ? ` { ${p.params} }` : ''}`;
    case 'classify': {
      const intents = (p.intents || 'заказ\nжалоба').split('\n').filter(Boolean);
      return `${pad}классифицировать [${intents.map((i) => `"${i.trim()}"`).join(' | ')}] → ${p.varname || 'намерение'}`;
    }
    case 'role': {
      const roles = (p.roles || 'admin\nuser').split('\n').filter(Boolean).map((r) => r.trim());
      const cond = roles.map((r) => `${p.varname || 'роль'} == "${r}"`).join(' или ');
      return `${pad}если ${cond}:`;
    }
    case 'use':
      return `${pad}использовать ${p.blockname || 'block'}`;
    default:
      return `${pad}# [${block.type}]`;
  }
}

export function stackToDSL(stack) {
  const blocks = stack.blocks;
  if (!blocks || blocks.length === 0) return '';

  const first = blocks[0];
  const header = emitBlock(first, 0);
  if (blocks.length === 1) return header;

  const lines = [];
  let indent = 1;
  const SCOPE_RESET = new Set(['condition', 'else', 'stop', 'goto', 'step']);

  for (let i = 1; i < blocks.length; i += 1) {
    const b = blocks[i];
    const prevType = blocks[i - 1].type;

    if (b.type === 'condition' || b.type === 'else' || b.type === 'step') {
      indent = 1;
    } else if (b.props?._afterScope) {
      indent = 1;
    } else if (SCOPE_OPENERS.has(prevType)) {
      indent = 2;
    } else if (SCOPE_RESET.has(prevType)) {
      indent = 1;
    }

    lines.push(emitBlock(b, indent));
  }

  return `${header}\n${lines.join('\n')}`;
}

/** Стеки на холсте → текст .ccd (как в основном редакторе). */
export function generateDSLFromStacks(stacks) {
  if (stacks.length === 0) return '# добавь блоки на холст';

  const sorted = [...stacks].sort((a, b) => a.y - b.y);

  const SETTINGS_TYPES = new Set(['bot', 'version', 'global', 'commands']);
  const settingsStacks = sorted.filter((s) => s.blocks.length > 0 && SETTINGS_TYPES.has(s.blocks[0].type));
  const regularStacks = sorted.filter((s) => s.blocks.length === 0 || !SETTINGS_TYPES.has(s.blocks[0].type));

  const parts = [];
  if (settingsStacks.length > 0) {
    parts.push(settingsStacks.map((s) => stackToDSL(s)).join('\n'));
  }
  parts.push(...regularStacks.map((s) => stackToDSL(s)));

  return parts.filter(Boolean).join('\n\n');
}

/** ---------- Граф Flow (nodes + edges) ---------- */

export function nodeDSL(node, edges, allNodes, indent = 0) {
  const t = node.type;
  const p = node.props || {};
  const pad = '    '.repeat(indent);
  const ir = () => ({ type: t, props: p });

  const childIds = edges.filter((e) => e.source === node.id).map((e) => e.target);
  const childNodes = childIds
    .map((id) => allNodes.find((n) => n.id === id))
    .filter(Boolean)
    .filter(
      (n) =>
        ![
          'callback',
          'start',
          'version',
          'bot',
          'commands',
          'global',
          'middleware',
          'on_text',
          'on_photo',
          'on_voice',
          'on_document',
          'on_sticker',
          'on_location',
          'on_contact',
        ].includes(n.type),
    );

  const childDSL = () =>
    childNodes
      .map((c) => {
        if (c.type === 'block') {
          const childPad = '    '.repeat(indent + 1);
          return `${childPad}использовать ${(c.props || {}).name || 'block_name'}`;
        }
        return nodeDSL(c, edges, allNodes, indent + 1);
      })
      .join('\n');

  switch (t) {
    case 'version':
    case 'bot':
    case 'commands':
    case 'global':
    case 'use':
    case 'message':
    case 'buttons':
    case 'inline':
    case 'poll':
    case 'ask':
    case 'remember':
    case 'get':
    case 'save':
    case 'random':
    case 'switch':
    case 'photo':
    case 'video':
    case 'audio':
    case 'document':
    case 'sticker':
    case 'contact':
    case 'location':
    case 'delay':
    case 'typing':
    case 'http':
    case 'goto':
    case 'stop':
    case 'notify':
    case 'database':
    case 'classify':
    case 'log':
    case 'payment':
    case 'analytics':
      return emitBlock(ir(), indent);

    case 'block': {
      const head = emitBlock({ type: 'block', props: { ...p, return: false } }, indent);
      const tail = p.return === 'true' || p.return === true ? `\n${pad}    вернуть` : '';
      return `${head}\n${childDSL() || `${pad}    ответ "..."`}${tail}`;
    }

    case 'middleware': {
      const head = emitBlock(
        { type: 'middleware', props: { ...p, return: false } },
        indent,
      );
      const body = childDSL() || `${pad}    лог "..."`;
      const ret =
        p.return === 'true' || p.return === true ? `\n${pad}    вернуть` : '';
      return `${head}\n${body}${ret}`;
    }

    case 'start':
      return `${emitBlock(ir(), indent)}\n${childDSL() || '    ответ "Привет!"'}`;

    case 'command': {
      const body = childDSL() || '    ответ "..."';
      return `${emitBlock(ir(), indent)}\n${body}`;
    }

    case 'condition': {
      const answerLabel = 'ответ';
      return `${emitBlock(ir(), indent)}\n${childDSL() || `${pad}    ${answerLabel} "Да"`}`;
    }

    case 'else': {
      const answerLabel = 'ответ';
      return `${emitBlock(ir(), indent)}\n${childDSL() || `    ${answerLabel} "..."`}`;
    }

    case 'role':
      return `${emitBlock(ir(), indent)}\n${childDSL() || `${pad}    ответ "Доступ разрешён"`}`;

    case 'loop': {
      const head = emitBlock(ir(), indent);
      const body = childDSL() || `${pad}    ответ "..."`;
      return `${head}\n${body}`;
    }

    case 'menu':
      return emitBlock(ir(), indent);

    case 'scenario': {
      const stepChildren = childNodes.filter((c) => c.type === 'step');
      if (stepChildren.length > 0 || childNodes.every((c) => c.type === 'step')) {
        const stepsStr = childNodes.map((c) => nodeDSL(c, edges, allNodes, 1)).join('\n');
        return `сценарий ${p.name || 'регистрация'}:\n${stepsStr}`;
      }
      const body =
        childNodes.length > 0
          ? childNodes.map((c) => nodeDSL(c, edges, allNodes, 2)).join('\n')
          : `        ответ "${p.text || 'Начинаем!'}"`;
      return `сценарий ${p.name || 'регистрация'}:\n    шаг начало:\n${body}`;
    }

    case 'step': {
      const stepBody =
        childNodes.length > 0
          ? childNodes.map((c) => nodeDSL(c, edges, allNodes, indent + 1)).join('\n')
          : `${'    '.repeat(indent + 1)}ответ "${p.text || '...'}"`;
      return `${pad}шаг ${p.name || 'шаг1'}:\n${stepBody}`;
    }

    case 'callback': {
      const base = emitBlock({ type: 'callback', props: { ...p, return: false } }, indent);
      return `${base}\n${childDSL() || '    ответ "..."'}${p.return === 'true' || p.return === true ? '\n    вернуть' : ''}`;
    }

    case 'on_text':
      return `${emitBlock(ir(), indent)}\n${childDSL() || '    ответ "Получил текст!"'}`;

    case 'on_photo':
      return `${emitBlock(ir(), indent)}\n${childDSL() || '    ответ "Получил фото!"'}`;
    case 'on_voice':
      return `${emitBlock(ir(), indent)}\n${childDSL() || '    ответ "Получил голосовое!"'}`;
    case 'on_document':
      return `${emitBlock(ir(), indent)}\n${childDSL() || '    ответ "Получил документ!"'}`;
    case 'on_sticker':
      return `${emitBlock(ir(), indent)}\n${childDSL() || '    ответ "Классный стикер!"'}`;
    case 'on_location':
      return `${emitBlock(ir(), indent)}\n${childDSL() || '    ответ "Получил геолокацию!"'}`;
    case 'on_contact':
      return `${emitBlock(ir(), indent)}\n${childDSL() || '    ответ "Получил контакт!"'}`;

    default:
      return emitBlock(ir(), indent);
  }
}

/** Граф (React Flow) → DSL; token подставляет заголовок «бот», если узла бота нет. */
export function generateDSLFromFlow(flow, token) {
  const { nodes = [], edges = [] } = flow;
  if (nodes.length === 0) return '# добавь блоки на холст';

  const globalNodes = nodes.filter((n) =>
    ['version', 'bot', 'commands', 'global', 'block', 'middleware'].includes(n.type),
  );
  const regularNodes = nodes.filter(
    (n) => !['version', 'bot', 'commands', 'global', 'block', 'middleware'].includes(n.type),
  );

  const blockChildIds = new Set(
    globalNodes
      .filter((n) => ['block', 'middleware'].includes(n.type))
      .flatMap((n) => edges.filter((e) => e.source === n.id).map((e) => e.target)),
  );

  const MEDIA_TRIGGERS = [
    'on_text',
    'on_photo',
    'on_voice',
    'on_document',
    'on_sticker',
    'on_location',
    'on_contact',
  ];

  const roots = regularNodes.filter((n) => {
    if (blockChildIds.has(n.id)) return false;
    const isRoot = ['start', 'command', 'scenario', 'callback', 'else', ...MEDIA_TRIGGERS].includes(
      n.type,
    );
    const hasParent = edges.some((e) => e.target === n.id);
    const alwaysRoot = ['callback', 'start', 'else', ...MEDIA_TRIGGERS].includes(n.type);
    return isRoot && (!hasParent || alwaysRoot);
  });

  const toRender =
    roots.length > 0 ? roots : regularNodes.filter((n) => !blockChildIds.has(n.id));

  let dsl = '';

  if (globalNodes.length > 0) {
    dsl += globalNodes.map((r) => nodeDSL(r, edges, nodes)).join('\n\n') + '\n\n';
  }

  dsl += toRender.map((r) => nodeDSL(r, edges, nodes)).join('\n\n');

  if (!dsl.trim()) return '# добавь блоки на холст';

  const hasBotNode = globalNodes.some((n) => n.type === 'bot');
  const header = !hasBotNode && token ? `бот "${token}"\n\n` : '';

  return header + dsl;
}

/**
 * Оборачивает фрагмент DSL в минимальную программу (версия, бот, при команде или при старте).
 * Для roundtrip-тестов: parser.py ожидает валидный верхний уровень.
 */
export function applyMinimalProgram(dslBody, wrap) {
  if (!wrap) return dslBody;
  const ver = wrap.version ?? '1.0';
  const botToken = wrap.bot ?? '0:dummy';
  const lines = [`версия "${ver}"`, `бот "${botToken}"`, ''];
  const indented = dslBody
    .split('\n')
    .map((ln) => `    ${ln}`)
    .join('\n');
  if (wrap.start) {
    lines.push('при старте:');
    lines.push(indented);
  } else {
    const cmd = String(wrap.command ?? '/t').replace(/^\//, '');
    lines.push(`при команде "/${cmd}":`);
    lines.push(indented);
  }
  return lines.join('\n');
}

/**
 * Утилита для тестов и инструментов: один JSON-IR → строка DSL.
 *
 * kind:
 * - emitBlock: { kind, indent?, block: { type, props? }, wrap? }
 * - wrappedChain: { kind, wrap, blocks: [{ indent?, block }] }
 * - stacks:    { kind, stacks }
 * - flow:      { kind, flow, token? }
 */
export function renderIr(ir) {
  if (!ir || typeof ir.kind !== 'string') {
    throw new Error('renderIr: ожидается объект с полем kind');
  }
  switch (ir.kind) {
    case 'emitBlock': {
      const b = ir.block;
      if (!b || typeof b.type !== 'string') {
        throw new Error('renderIr(emitBlock): нужен block.type');
      }
      const dsl = emitBlock(b, ir.indent ?? 0);
      return applyMinimalProgram(dsl, ir.wrap);
    }
    case 'wrappedChain': {
      const parts = (ir.blocks || []).map((entry) =>
        emitBlock(entry.block, entry.indent ?? 0),
      );
      return applyMinimalProgram(parts.join('\n'), ir.wrap);
    }
    case 'stacks':
      return generateDSLFromStacks(ir.stacks ?? []);
    case 'flow':
      return generateDSLFromFlow(ir.flow ?? { nodes: [], edges: [] }, ir.token ?? '');
    default:
      throw new Error(`renderIr: неизвестный kind "${ir.kind}"`);
  }
}

export function validateFlow(flow) {
  const { nodes = [], edges = [] } = flow;
  const errors = [];
  const warnings = [];
  const standaloneTypes = new Set(['version', 'bot', 'commands', 'global']);

  if (nodes.length === 0) {
    warnings.push('Холст пуст — добавь блоки');
    return { errors, warnings };
  }

  const startNodes = nodes.filter((n) => n.type === 'start');
  if (startNodes.length === 0) warnings.push('Нет блока «Старт» — бот не знает с чего начать');
  if (startNodes.length > 1) warnings.push(`Несколько блоков «Старт» (${startNodes.length} шт.)`);

  nodes.forEach((n) => {
    const p = n.props || {};
    const outgoing = edges.filter((e) => e.source === n.id).length;

    switch (n.type) {
      case 'version':
        if (!p.version?.trim()) errors.push(`Блок «Версия» [${n.id}]: не указана версия`);
        break;
      case 'bot':
        if (!p.token?.trim()) warnings.push(`Блок «Бот» [${n.id}]: не указан токен`);
        break;
      case 'commands':
        if (!p.commands?.trim()) warnings.push(`Блок «Команды меню» [${n.id}]: нет команд`);
        break;
      case 'global':
        if (!p.varname?.trim()) errors.push(`Блок «Глобальная» [${n.id}]: нет имени переменной`);
        break;
      case 'block':
        if (!p.name?.trim()) errors.push(`Блок «Блок» [${n.id}]: нет имени блока`);
        break;
      case 'use':
        if (!p.blockname?.trim()) errors.push(`Блок «Использовать» [${n.id}]: не указано имя блока`);
        break;
      case 'middleware':
        if (!p.type?.trim() || !['before', 'after'].includes(p.type))
          errors.push(`Блок «Middleware» [${n.id}]: неверный тип (before/after)`);
        break;
      case 'message':
        if (!p.text?.trim()) errors.push(`Блок «Ответ» [${n.id}]: пустой текст`);
        break;
      case 'buttons':
        if (!p.rows?.trim()) errors.push(`Блок «Кнопки» [${n.id}]: нет кнопок`);
        break;
      case 'inline': {
        if (!p.buttons?.trim()) {
          errors.push(`Блок «Inline-кнопки» [${n.id}]: нет кнопок`);
          break;
        }
        const inlineRows = p.buttons.trim().split('\n');
        inlineRows.forEach((row, ri) => {
          row.split(',').forEach((btn, bi) => {
            const parts = btn.trim().split('|');
            if (parts.length < 2 || !parts[0].trim() || !parts[1].trim()) {
              errors.push(
                `Блок «Inline-кнопки» [${n.id}]: кнопка ${ri + 1}.${bi + 1} — неверный формат, нужно "Текст|callback"`,
              );
            }
          });
        });
        const inlineParents = edges.filter((e) => e.target === n.id).map((e) => e.source);
        if (inlineParents.length === 0) {
          warnings.push(`Блок «Inline-кнопки» [${n.id}]: не подключён к родительскому блоку`);
        } else {
          const hasSiblingMessage = inlineParents.some((parentId) =>
            edges
              .filter((e) => e.source === parentId)
              .map((e) => e.target)
              .some((sibId) => {
                const sib = nodes.find((nd) => nd.id === sibId);
                return sib && sib.type === 'message';
              }),
          );
          if (!hasSiblingMessage) {
            warnings.push(
              `Блок «Inline-кнопки» [${n.id}]: нет блока «Ответ» в том же родителе — кнопки отправятся без текста`,
            );
          }
        }
        break;
      }
      case 'command':
        if (!p.cmd?.trim()) errors.push(`Блок «Команда» [${n.id}]: не указана команда`);
        if (outgoing === 0) warnings.push(`Команда /${p.cmd || '?'} не имеет дочерних блоков`);
        break;
      case 'condition':
        if (!p.cond?.trim()) errors.push(`Блок «Условие» [${n.id}]: пустое условие`);
        break;
      case 'else':
        break;
      case 'switch':
        if (!p.varname?.trim()) errors.push(`Блок «Переключатель» [${n.id}]: не указана переменная`);
        if (!p.cases?.trim()) errors.push(`Блок «Переключатель» [${n.id}]: нет вариантов`);
        break;
      case 'ask':
        if (!p.question?.trim()) errors.push(`Блок «Спросить» [${n.id}]: нет вопроса`);
        if (!p.varname?.trim()) errors.push(`Блок «Спросить» [${n.id}]: нет переменной`);
        break;
      case 'remember':
        if (!p.varname?.trim()) errors.push(`Блок «Запомнить» [${n.id}]: нет переменной`);
        break;
      case 'get':
        if (!p.key?.trim()) errors.push(`Блок «Получить» [${n.id}]: нет ключа`);
        if (!p.varname?.trim()) errors.push(`Блок «Получить» [${n.id}]: нет переменной`);
        break;
      case 'save':
        if (!p.key?.trim()) errors.push(`Блок «Сохранить» [${n.id}]: нет ключа`);
        break;
      case 'http':
        if (!p.url?.trim()) errors.push(`Блок «HTTP» [${n.id}]: не указан URL`);
        if (!p.varname?.trim()) warnings.push(`Блок «HTTP» [${n.id}]: не указана переменная для ответа`);
        break;
      case 'goto':
        if (!(p.target || p.label || '').toString().trim())
          errors.push(`Блок «Переход» [${n.id}]: не указан сценарий`);
        break;
      case 'random':
        if (!p.variants?.trim()) errors.push(`Блок «Рандом» [${n.id}]: нет вариантов`);
        break;
      case 'photo':
      case 'video':
      case 'audio':
      case 'document':
        if (!p.url?.trim()) warnings.push(`Блок «${n.type}» [${n.id}]: не указан URL`);
        break;
      case 'delay':
      case 'typing':
        if (!p.seconds || isNaN(Number(p.seconds)))
          errors.push(`Блок «${n.type}» [${n.id}]: некорректное число секунд`);
        break;
      case 'loop':
        if (p.mode === 'while' && !p.cond?.trim())
          errors.push(`Блок «Цикл» [${n.id}]: не указано условие`);
        if (p.mode !== 'while' && (!p.count || isNaN(Number(p.count))))
          errors.push(`Блок «Цикл» [${n.id}]: некорректное число повторений`);
        break;
      case 'database':
        if (!p.query?.trim()) errors.push(`Блок «БД» [${n.id}]: не указан SQL-запрос`);
        if (!p.varname?.trim()) warnings.push(`Блок «БД» [${n.id}]: не указана переменная для результата`);
        break;
      case 'classify':
        if (!p.intents?.trim()) errors.push(`Блок «Классификация» [${n.id}]: не указаны намерения`);
        if (!p.varname?.trim()) errors.push(`Блок «Классификация» [${n.id}]: не указана переменная`);
        break;
      case 'log':
        if (!p.message?.trim()) warnings.push(`Блок «Лог» [${n.id}]: пустое сообщение`);
        break;
      case 'role':
        if (!p.roles?.trim()) errors.push(`Блок «Роль» [${n.id}]: не указаны роли`);
        break;
      case 'payment':
        if (!p.amount?.trim() || isNaN(Number(p.amount)))
          errors.push(`Блок «Оплата» [${n.id}]: некорректная сумма`);
        if (!p.provider?.trim()) errors.push(`Блок «Оплата» [${n.id}]: не указан провайдер`);
        break;
      case 'notify':
        if (!p.text?.trim()) errors.push(`Блок «Уведомление» [${n.id}]: пустой текст`);
        break;
      default:
        break;
    }
  });

  const rootTypes = [
    'start',
    'command',
    'scenario',
    'callback',
    'on_text',
    'on_photo',
    'on_voice',
    'on_document',
    'on_sticker',
    'on_location',
    'on_contact',
  ];
  nodes.forEach((n) => {
    if (!rootTypes.includes(n.type) && !standaloneTypes.has(n.type)) {
      const hasParent = edges.some((e) => e.target === n.id);
      if (!hasParent) warnings.push(`«${n.label || n.type}» [${n.id}] не подключён ни к одному блоку`);
    }
  });

  return { errors, warnings };
}

/**
 * Константы контрактов для Studio/UI — синхронизировать со schemas/schema-versions.json при релизе.
 */
export const SCHEMA_VERSIONS_FOR_UI = Object.freeze({
  irSchemaVersion: 1,
  astSchemaVersion: 1,
  dslSnapshotManifestVersion: 1,
  capabilitiesManifestVersion: 1,
  projectManifestFormatVersion: 1,
  buildGraphFormatVersion: 2,
});

/** Одна точка правды: тип блока/узла → множество имён фич (parser-capabilities). */
function collectFeaturesForBlockType(type, props, feats) {
  const p = props || {};
  switch (type) {
    case 'start':
      feats.add('handler_start');
      break;
    case 'command':
      feats.add('handler_command');
      break;
    case 'callback':
      feats.add('handler_callback');
      break;
    case 'on_text':
      feats.add('handler_text');
      break;
    case 'on_photo':
    case 'photo_received':
      feats.add('handler_photo_received');
      break;
    case 'on_document':
    case 'document_received':
      feats.add('handler_document_received');
      break;
    case 'on_voice':
    case 'voice_received':
      feats.add('handler_voice_received');
      break;
    case 'on_sticker':
    case 'sticker_received':
      feats.add('handler_sticker_received');
      break;
    case 'on_location':
    case 'location_received':
      feats.add('handler_location_received');
      break;
    case 'on_contact':
    case 'contact_received':
      feats.add('handler_contact_received');
      break;
    default:
      break;
  }

  switch (type) {
    case 'switch':
      feats.add('switch');
      break;
    case 'inline':
      feats.add('inline_buttons');
      feats.add('inline_keyboard');
      break;
    case 'condition':
    case 'else':
      feats.add('if_else');
      break;
    case 'message':
    case 'ask':
    case 'random':
      feats.add('reply');
      break;
    case 'middleware': {
      const mt = p.type;
      if (mt === 'before') feats.add('middleware_before_each');
      if (mt === 'after') feats.add('middleware_after_each');
      break;
    }
    default:
      break;
  }
}

/**
 * Эвристика фич для Flow (React Flow).
 * Совместимо по именам с manifests/parser-capabilities.default.json.
 */
export function inferRequiredFeaturesFromFlow(flow) {
  const { nodes = [] } = flow || {};
  const feats = new Set();
  for (const n of nodes) {
    collectFeaturesForBlockType(n.type, n.props, feats);
  }
  return [...feats].sort();
}

/** Эвристика фич для стекового редактора (массив стеков с blocks). */
export function inferRequiredFeaturesFromStacks(stacks) {
  const feats = new Set();
  for (const st of stacks || []) {
    for (const b of st.blocks || []) {
      collectFeaturesForBlockType(b.type, b.props, feats);
    }
  }
  return [...feats].sort();
}

export function buildProjectManifestDraft(flow, schemaVersions = SCHEMA_VERSIONS_FOR_UI) {
  return {
    projectFormatVersion: schemaVersions.projectManifestFormatVersion,
    requiredFeatures: inferRequiredFeaturesFromFlow(flow),
    requiredAstSchemaVersion: schemaVersions.astSchemaVersion,
    notes: 'Черновик из Studio (dslCodegen)',
  };
}

export function buildProjectManifestDraftFromStacks(stacks, schemaVersions = SCHEMA_VERSIONS_FOR_UI) {
  return {
    projectFormatVersion: schemaVersions.projectManifestFormatVersion,
    requiredFeatures: inferRequiredFeaturesFromStacks(stacks),
    requiredAstSchemaVersion: schemaVersions.astSchemaVersion,
    notes: 'Черновик из Studio — стеки',
  };
}
