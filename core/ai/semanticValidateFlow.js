/**
 * Семантическая валидация потока после успешного **грамматического** разбора (parser.py).
 * JS-пайплайн `parseCCDToFlow` используется только как IR студии, не как источник грамматики.
 *
 * При изменении правил здесь поднимите `SEMANTIC_RULES_VERSION` в `core/diagnostics/pipelineFingerprintV1.js`.
 */

import { validateFlow } from '../dslCodegen.js';

/**
 * @param {{ nodes?: unknown[], edges?: unknown[] }} flow
 * @returns {{ ok: boolean, errors: Array<{ type: string, message: string, nodeId?: string }>, warnings: string[] }}
 */
export function semanticValidateFlow(flow) {
  const vf = validateFlow(flow);
  /** @type {Array<{ type: string, message: string, nodeId?: string }>} */
  const errors = vf.errors.map((msg) => ({ type: 'FlowGraphError', message: msg }));
  /** @type {string[]} */
  const warnings = [...vf.warnings];

  const nodes = flow?.nodes || [];
  for (const n of nodes) {
    const id = typeof n?.id === 'string' ? n.id : undefined;
    const data = /** @type {{ type?: string, props?: Record<string, unknown> }} */ (n?.data || {});
    const t = data.type || /** @type {{ type?: string }} */ (n)?.type;

    if (t === 'poll') {
      const q = String(data.props?.question || '').trim();
      const opt = String(data.props?.options || '').trim();
      if (!q) errors.push({ type: 'SemanticError', message: 'Опрос: пустой вопрос', nodeId: id });
      if (!opt) errors.push({ type: 'SemanticError', message: 'Опрос: нет вариантов ответа', nodeId: id });
    }

    if (t === 'random') {
      const v = String(data.props?.variants || '').trim();
      if (!v) errors.push({ type: 'SemanticError', message: 'Рандом: нет вариантов', nodeId: id });
    }

    if (t === 'message') {
      const text = String(data.props?.text || '').trim();
      if (!text && !data.props?.media) {
        errors.push({ type: 'SemanticError', message: 'Ответ: пустой текст', nodeId: id });
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}
