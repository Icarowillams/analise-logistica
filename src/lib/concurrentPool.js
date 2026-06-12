/**
 * Executa uma lista de itens em paralelo com concorrência limitada (pool).
 * Usado APENAS para downloads de PDF já prontos (ObterBoleto/ObterDanfe) —
 * leitura de documento, não emissão. Emissão NUNCA usa isto.
 *
 * @param {Array} itens                 lista a processar
 * @param {(item, index) => Promise} worker  função que processa 1 item
 * @param {object} opts
 *   - concorrencia: máximo de tarefas simultâneas (default 5)
 *   - onProgress: chamado a cada item resolvido (ok|erro)
 * @returns {Promise<Array<{item, index, ok, value?, error?}>>} resultados na ordem original
 */
export async function runPool(itens, worker, { concorrencia = 5, onProgress } = {}) {
  const resultados = new Array(itens.length);
  let cursor = 0;

  const rodarUm = async () => {
    while (cursor < itens.length) {
      const idx = cursor++;
      const item = itens[idx];
      try {
        const value = await worker(item, idx);
        resultados[idx] = { item, index: idx, ok: true, value };
      } catch (error) {
        resultados[idx] = { item, index: idx, ok: false, error };
      }
      if (onProgress) onProgress(resultados[idx]);
    }
  };

  const workers = Array.from(
    { length: Math.min(concorrencia, itens.length) },
    () => rodarUm()
  );
  await Promise.all(workers);
  return resultados;
}