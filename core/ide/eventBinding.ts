export interface ButtonSpec {
  id: string;
  text: string;
  block: string;
  line: number;
}

export interface ButtonHandlerSpec {
  buttonId: string;
  line: number;
}

export interface EventBindingAst {
  buttons: readonly ButtonSpec[];
  handlers: readonly ButtonHandlerSpec[];
}

export interface EventRegistryItem {
  id: string;
  text: string;
  block: string;
}

export interface EventRegistry {
  buttonsById: ReadonlyMap<string, EventRegistryItem>;
  buttons: readonly EventRegistryItem[];
}

export interface EventDiagnostics {
  duplicateIds: readonly string[];
  unusedButtons: readonly string[];
  missingHandlers: readonly string[];
}

const BLOCK_RE = /^\s*блок\s+([^:]+):\s*$/i;
const BTN_ROW_RE = /^\s*кнопки\s+(.+)\s*$/i;
const BTN_INLINE_RE = /^\s*\[\s*id\s*=\s*([A-Za-z0-9_-]+)\s+text\s*=\s*"([^"]+)"\s*\]\s*$/i;
const HANDLER_RE = /^\s*при\s+нажатии\s+"?([A-Za-z0-9_-]+|[^"]+)"?\s*:\s*$/i;

function normalizeId(seed: string): string {
  return seed.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'btn';
}

export function parseEventBindingDsl(source: string): EventBindingAst {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const buttons: ButtonSpec[] = [];
  const handlers: ButtonHandlerSpec[] = [];
  let currentBlock = 'global';

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const blockMatch = line.match(BLOCK_RE);
    if (blockMatch) {
      currentBlock = blockMatch[1].trim();
      continue;
    }

    const inlineBtn = line.match(BTN_INLINE_RE);
    if (inlineBtn) {
      buttons.push({ id: inlineBtn[1], text: inlineBtn[2], block: currentBlock, line: i + 1 });
      continue;
    }

    const rowMatch = line.match(BTN_ROW_RE);
    if (rowMatch) {
      const texts = [...rowMatch[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
      texts.forEach((text, idx) => buttons.push({ id: normalizeId(`${currentBlock}_${text}_${idx + 1}`), text, block: currentBlock, line: i + 1 }));
      continue;
    }

    const handlerMatch = line.match(HANDLER_RE);
    if (handlerMatch) {
      handlers.push({ buttonId: handlerMatch[1].trim(), line: i + 1 });
    }
  }

  return Object.freeze({ buttons: Object.freeze(buttons), handlers: Object.freeze(handlers) });
}

export function buildEventRegistry(ast: EventBindingAst): EventRegistry {
  const buttons = ast.buttons.map((b) => ({ id: b.id, text: b.text, block: b.block }));
  const byId = new Map<string, EventRegistryItem>();
  buttons.forEach((b) => byId.set(b.id, b));
  return Object.freeze({ buttonsById: byId, buttons: Object.freeze(buttons) });
}

export function buildButtonSelectorOptions(registry: EventRegistry): readonly { value: string; label: string }[] {
  return Object.freeze(registry.buttons.map((b) => ({ value: b.id, label: `${b.block} / ${b.text}` })));
}

export function generateHandlerDsl(button: EventRegistryItem): string {
  return `при нажатии ${button.id}:\n    ответ \"Нажата ${button.text}\"`;
}

export function validateEventBindings(ast: EventBindingAst): EventDiagnostics {
  const idCounts = new Map<string, number>();
  ast.buttons.forEach((b) => idCounts.set(b.id, (idCounts.get(b.id) ?? 0) + 1));
  const duplicateIds = [...idCounts.entries()].filter(([, count]) => count > 1).map(([id]) => id);

  const handlerIds = new Set(ast.handlers.map((h) => h.buttonId));
  const buttonIds = new Set(ast.buttons.map((b) => b.id));

  const unusedButtons = ast.buttons.map((b) => b.id).filter((id) => !handlerIds.has(id));
  const missingHandlers = [...handlerIds].filter((id) => !buttonIds.has(id));

  return Object.freeze({
    duplicateIds: Object.freeze(duplicateIds),
    unusedButtons: Object.freeze(unusedButtons),
    missingHandlers: Object.freeze(missingHandlers),
  });
}

export function createHandlerNodeFromButton(buttonId: string): { type: 'event-handler'; subscribeTo: string } {
  return { type: 'event-handler', subscribeTo: buttonId };
}
