import { useState, useEffect } from 'react';

/**
 * Debounce hook — atrasa a atualização do valor para reduzir chamadas desnecessárias.
 * @param {any} value - Valor a ser "debounced"
 * @param {number} delay - Delay em ms (padrão 300)
 */
export default function useDebounce(value, delay = 300) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}