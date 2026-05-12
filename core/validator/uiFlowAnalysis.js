const CY_END = '(?![а-яёА-ЯЁa-zA-Z_0-9])';

function getLineIndent(rawLine) {
  return (rawLine.replace(/\t/g, '    ').match(/^(\s*)/)?.[1]?.length) ?? 0;
}

function parseDslTree(code) {
  const lines = String(code || '').replace(/\r\n/g, '\n').split('\n');
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

function lastLineOf(node) {
  if (!node?.children?.length) return node?.line || 0;
  return Math.max(node.line, ...node.children.map(lastLineOf));
}

function cleanTarget(raw) {
  let target = String(raw || '').trim().replace(/:$/, '').trim();
  const quoted = target.match(/^["«“'](.+?)["»”']$/);
  if (quoted) target = quoted[1].trim();
  return target;
}

function commandKeys(cmd) {
  const clean = cleanTarget(cmd).replace(/^\/+/, '');
  if (!clean) return [];
  return [clean, `/${clean}`];
}

function firstRootName(text, keyword) {
  const re = new RegExp(`^${keyword}\\s+([а-яёa-zA-Z_][а-яёa-zA-Z_0-9]*)\\s*:?\\s*$`, 'i');
  return text.match(re)?.[1] || null;
}

function commandName(text) {
  return text.match(/^(?:при\s+команде|команда)\s+"?\/?([^":]+)"?\s*:?\s*$/i)?.[1]?.trim() || null;
}

function isStartHeader(text) {
  return /^(?:при\s+старте|старт)\s*:?\s*$/i.test(text);
}

function isClickHeader(text) {
  return /^при\s+нажатии(?:\s+"[^"]+")?\s*:?\s*$/i.test(text);
}

function isHandlerHeader(text) {
  return (
    isStartHeader(text) ||
    isClickHeader(text) ||
    /^(?:при\s+команде|команда)\s+"?\/?[^":]+"?\s*:?\s*$/i.test(text) ||
    new RegExp(`^при\\s+(?:тексте|фото|документе|голосовом|стикере|геолокации|локации|контакте)${CY_END}`, 'i').test(text)
  );
}

function indexDslTree(root) {
  const blocks = new Map();
  const scenarios = new Map();
  const commands = new Map();
  const steps = new Map();
  const handlers = [];

  const collectSteps = (node) => {
    (node.children || []).forEach((child) => {
      const stepName = firstRootName(child.text, 'шаг');
      if (stepName && !steps.has(stepName)) steps.set(stepName, child);
      collectSteps(child);
    });
  };

  (root.children || []).forEach((node) => {
    const blockName = firstRootName(node.text, 'блок');
    if (blockName) blocks.set(blockName, node);

    const scenarioName = firstRootName(node.text, 'сценарий');
    if (scenarioName) scenarios.set(scenarioName, node);

    const cmd = commandName(node.text);
    if (cmd) commandKeys(cmd).forEach((key) => commands.set(key, node));
    if (isStartHeader(node.text)) {
      commands.set('/start', node);
      commands.set('start', node);
    }

    if (isHandlerHeader(node.text)) handlers.push(node);
    collectSteps(node);
  });

  return { blocks, scenarios, commands, steps, handlers };
}

function blankSummary() {
  return {
    hasOutput: false,
    hasReplyOutput: false,
    hasReachableKeyboard: false,
    hasTransition: false,
    hasBlockUse: false,
    hasTerminalAction: false,
    fallsThrough: true,
    terminalStates: [],
  };
}

function mergeSummary(into, from) {
  if (!from) return into;
  into.hasOutput ||= Boolean(from.hasOutput);
  into.hasReplyOutput ||= Boolean(from.hasReplyOutput);
  into.hasReachableKeyboard ||= Boolean(from.hasReachableKeyboard);
  into.hasTransition ||= Boolean(from.hasTransition);
  into.hasBlockUse ||= Boolean(from.hasBlockUse);
  into.hasTerminalAction ||= Boolean(from.hasTerminalAction);
  if (Array.isArray(from.terminalStates)) into.terminalStates.push(...from.terminalStates);
  return into;
}

function isReplyOutput(text) {
  return /^(?:ответ|ответ_md|ответ_html|ответ_md2|ответ_markdown_v2)\s+/i.test(text) || text === 'рандом:' || text === 'рандом';
}

function isVisibleOutput(text) {
  return (
    isReplyOutput(text) ||
    new RegExp(`^(?:спросить|фото|картинка|голос|видео|аудио|документ|стикер|контакт|локация|опрос|отправить\\s+файл|уведомить)${CY_END}`, 'i').test(text)
  );
}

function isKeyboardOutput(text) {
  return (
    /^кнопки(?:\s|:|$)/i.test(text) ||
    /^inline-кнопки:?\s*$/i.test(text) ||
    /^inline(?:-кнопки)?\s+из\s+бд\s+/i.test(text)
  );
}

function isTerminalAction(text) {
  return new RegExp(`^(?:стоп|завершить(?:\\s+сценарий)?|вернуть|прервать)${CY_END}`, 'i').test(text);
}

function isIf(text) {
  return new RegExp(`^если${CY_END}`, 'i').test(text);
}

function isElse(text) {
  return new RegExp(`^иначе${CY_END}`, 'i').test(text);
}

function blockUseTarget(text) {
  const m = text.match(/^использовать\s+(.+?)\s*$/i);
  return m ? cleanTarget(m[1]) : null;
}

function transitionTarget(text) {
  const gotoMatch = text.match(/^перейти(?:\s+к\s+шаг)?\s+(.+?)\s*$/i);
  if (gotoMatch) return { kind: 'goto', target: cleanTarget(gotoMatch[1]) };

  const runMatch = text.match(/^запустить\s+(.+?)\s*$/i);
  if (runMatch) return { kind: 'run', target: cleanTarget(runMatch[1]) };

  return null;
}

function firstScenarioBodyNode(node) {
  const firstStep = (node.children || []).find((child) => firstRootName(child.text, 'шаг'));
  return firstStep || node;
}

function resolveTransitionTarget(ref, index) {
  const target = cleanTarget(ref?.target);
  if (!target) return null;

  if (ref.kind === 'run') {
    return (
      index.scenarios.get(target) ||
      index.commands.get(target) ||
      index.commands.get(`/${target.replace(/^\/+/, '')}`) ||
      null
    );
  }

  return (
    index.blocks.get(target) ||
    index.scenarios.get(target) ||
    index.steps.get(target) ||
    index.commands.get(target) ||
    index.commands.get(`/${target.replace(/^\/+/, '')}`) ||
    null
  );
}

function analyzeNodeBody(node, index, visiting) {
  if (!node) return blankSummary();
  const key = `${node.line}:${node.text}`;
  if (visiting.has(key)) {
    return {
      ...blankSummary(),
      hasTransition: true,
      terminalStates: [{ kind: 'cycle', line: node.line, text: node.text }],
    };
  }

  visiting.add(key);
  const bodyNode = firstRootName(node.text, 'сценарий') ? firstScenarioBodyNode(node) : node;
  const summary = analyzeSequence(bodyNode.children || [], index, visiting);
  visiting.delete(key);
  return summary;
}

function analyzeSequence(nodes, index, visiting) {
  const summary = blankSummary();
  let reachable = true;

  for (let i = 0; i < nodes.length; i += 1) {
    if (!reachable) break;

    const node = nodes[i];
    const text = node.text;

    if (isIf(text)) {
      const ifSummary = analyzeSequence(node.children || [], index, visiting);
      const elseNode = nodes[i + 1] && isElse(nodes[i + 1].text) ? nodes[i + 1] : null;
      const elseSummary = elseNode ? analyzeSequence(elseNode.children || [], index, visiting) : blankSummary();
      if (elseNode) i += 1;

      mergeSummary(summary, ifSummary);
      mergeSummary(summary, elseSummary);

      if (!ifSummary.fallsThrough && !elseSummary.fallsThrough) {
        reachable = false;
      }
      continue;
    }

    if (isElse(text)) {
      mergeSummary(summary, analyzeSequence(node.children || [], index, visiting));
      continue;
    }

    if (isKeyboardOutput(text)) {
      summary.hasOutput = true;
      summary.hasReachableKeyboard = true;
      summary.terminalStates.push({ kind: 'keyboard', line: node.line, text });
      continue;
    }

    if (isVisibleOutput(text)) {
      summary.hasOutput = true;
      summary.hasReplyOutput ||= isReplyOutput(text);
      continue;
    }

    const useTarget = blockUseTarget(text);
    if (useTarget) {
      summary.hasBlockUse = true;
      const targetSummary = analyzeNodeBody(index.blocks.get(cleanTarget(useTarget)), index, visiting);
      mergeSummary(summary, targetSummary);
      summary.terminalStates.push({ kind: 'block-use', line: node.line, text });
      continue;
    }

    const transition = transitionTarget(text);
    if (transition) {
      summary.hasTransition = true;
      const targetSummary = analyzeNodeBody(resolveTransitionTarget(transition, index), index, visiting);
      mergeSummary(summary, targetSummary);
      summary.terminalStates.push({ kind: transition.kind, line: node.line, text });
      reachable = false;
      continue;
    }

    if (isTerminalAction(text)) {
      summary.hasTerminalAction = true;
      summary.terminalStates.push({ kind: 'terminal', line: node.line, text });
      reachable = false;
      continue;
    }

    if (node.children?.length) {
      mergeSummary(summary, analyzeSequence(node.children, index, visiting));
    }
  }

  summary.fallsThrough = reachable;
  if (reachable) summary.terminalStates.push({ kind: 'fallthrough' });
  return summary;
}

export function analyzeDslControlFlow(code) {
  const root = parseDslTree(code);
  const index = indexDslTree(root);
  const handlers = index.handlers.map((node) => ({
    header: node.text,
    startLine: node.line,
    endLine: lastLineOf(node),
    baseIndent: node.indent,
    isClickHandler: isClickHeader(node.text),
    summary: analyzeNodeBody(node, index, new Set()),
  }));

  return {
    root,
    handlers,
    clickHandlers: handlers.filter((handler) => handler.isClickHandler),
  };
}

export function shouldInjectDefaultButtonsForClickHandler(summary) {
  // Kept for explicit callers only. collectDSLFixes intentionally does not use
  // this legacy fallback because cicada-tg 0.3.5 accepts reply-only handlers.
  void summary;
  return false;
}
