/**
 * Песочница / dry-run планировщика: без исполнения в Telegram, только эвристики политики и согласованности.
 * Не заменяет parser.py и не является семантическим «исполнителем».
 */

/**
 * @param {{ nodes?: unknown[], edges?: unknown[] }} flow
 * @param {{
 *   maxNodes?: number,
 *   maxHttpNodes?: number,
 *   forbidHttp?: boolean,
 *   forbidBroadcast?: boolean,
 *   maxGotoDepth?: number,
 * }} [policy]
 * @returns {{ ok: boolean, warnings: string[], blocked: Array<{ code: string, message: string }> }}
 */
export function dryRunFlowPolicy(flow, policy = {}) {
  const nodes = flow?.nodes || [];
  void flow?.edges;
  /** @type {string[]} */
  const warnings = [];
  /** @type {Array<{ code: string, message: string }>} */
  const blocked = [];

  const maxNodes = policy.maxNodes ?? 100_000;
  if (nodes.length > maxNodes) {
    blocked.push({ code: 'DRY_RUN_MAX_NODES', message: `Слишком много узлов (${nodes.length} > ${maxNodes})` });
  }

  let httpCount = 0;
  let broadcastCount = 0;
  let loopCount = 0;
  let gotoCount = 0;

  for (const n of nodes) {
    const data = /** @type {{ type?: string, props?: Record<string, unknown> }} */ (n?.data || {});
    const t = data.type || /** @type {{ type?: string }} */ (n)?.type;

    if (t === 'http') httpCount += 1;
    if (t === 'broadcast') broadcastCount += 1;
    if (t === 'loop' || t === 'random') loopCount += 1;
    if (t === 'goto') gotoCount += 1;
  }

  if (policy.forbidHttp && httpCount > 0) {
    blocked.push({ code: 'DRY_RUN_HTTP_FORBIDDEN', message: `HTTP-узлы запрещены политикой (${httpCount})` });
  }
  const maxHttp = policy.maxHttpNodes ?? Infinity;
  if (httpCount > maxHttp) {
    blocked.push({
      code: 'DRY_RUN_HTTP_LIMIT',
      message: `Слишком много HTTP-узлов (${httpCount} > ${maxHttp})`,
    });
  }
  if (policy.forbidBroadcast && broadcastCount > 0) {
    blocked.push({
      code: 'DRY_RUN_BROADCAST_FORBIDDEN',
      message: 'Рассылка запрещена политикой',
    });
  }

  if (loopCount > 0) {
    warnings.push(
      'Обнаружены циклы/рандом: при реальном исполнении нужны лимиты итераций и таймауты рантайма.',
    );
  }
  if (gotoCount > 0) {
    warnings.push(
      'Есть goto/переходы: проверьте глубину рекурсии и отсутствие бесконечных циклов в рантайме.',
    );
  }

  return { ok: blocked.length === 0, warnings, blocked };
}
