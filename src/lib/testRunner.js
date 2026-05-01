// Mini test runner — sem dependências externas

export function createSuite(name) {
  const tests = [];
  return {
    name,
    test: (description, fn) => tests.push({ description, fn }),
    run: async (onProgress) => {
      const results = [];
      for (let i = 0; i < tests.length; i++) {
        const t = tests[i];
        const startedAt = Date.now();
        let result;
        try {
          await t.fn();
          result = { description: t.description, passed: true, duration: Date.now() - startedAt };
        } catch (e) {
          result = {
            description: t.description,
            passed: false,
            error: e.message || String(e),
            stack: e.stack,
            duration: Date.now() - startedAt
          };
        }
        results.push(result);
        if (onProgress) onProgress({ index: i, total: tests.length, current: result });
      }
      return {
        name,
        results,
        total: results.length,
        passed: results.filter(r => r.passed).length,
        failed: results.filter(r => !r.passed).length
      };
    },
    count: () => tests.length
  };
}

// Asserts mínimos
export const assert = {
  equal: (actual, expected, msg = '') => {
    if (actual !== expected) {
      throw new Error(`${msg ? msg + ' — ' : ''}esperado ${JSON.stringify(expected)}, recebido ${JSON.stringify(actual)}`);
    }
  },
  deepEqual: (actual, expected, msg = '') => {
    const a = JSON.stringify(actual);
    const b = JSON.stringify(expected);
    if (a !== b) {
      throw new Error(`${msg ? msg + ' — ' : ''}esperado ${b}, recebido ${a}`);
    }
  },
  truthy: (v, msg = '') => {
    if (!v) throw new Error(`${msg || 'esperado truthy'}, recebido ${JSON.stringify(v)}`);
  },
  falsy: (v, msg = '') => {
    if (v) throw new Error(`${msg || 'esperado falsy'}, recebido ${JSON.stringify(v)}`);
  },
  includes: (arr, item, msg = '') => {
    if (!arr || !arr.includes(item)) {
      throw new Error(`${msg || 'esperado conter'} ${JSON.stringify(item)} em ${JSON.stringify(arr)}`);
    }
  },
  match: (str, regex, msg = '') => {
    if (!regex.test(str)) {
      throw new Error(`${msg || 'esperado match'} ${regex} em "${str}"`);
    }
  },
  greaterThan: (actual, expected, msg = '') => {
    if (!(actual > expected)) {
      throw new Error(`${msg || 'esperado'} ${actual} > ${expected}`);
    }
  },
  greaterOrEqual: (actual, expected, msg = '') => {
    if (!(actual >= expected)) {
      throw new Error(`${msg || 'esperado'} ${actual} >= ${expected}`);
    }
  }
};