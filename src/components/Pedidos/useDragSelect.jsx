import { useRef, useCallback, useEffect } from 'react';

/**
 * Hook para seleção por arrasto (drag-select) em linhas de tabela.
 * Ao clicar e arrastar nas linhas, as que ficam sob o cursor são selecionadas.
 * 
 * @param {string[]} filteredIds - IDs dos itens visíveis na tabela
 * @param {function} setSelectedIds - Setter do state de IDs selecionados
 * @returns {{ isDragging, onRowMouseDown, onRowMouseEnter, onMouseUp }}
 */
export default function useDragSelect(filteredIds, setSelectedIds) {
  const isDragging = useRef(false);
  const dragMode = useRef('add'); // 'add' ou 'remove'
  const startIdsSnapshot = useRef([]);

  const onRowMouseDown = useCallback((e, id, isSelected) => {
    // Ignorar cliques em checkboxes, botões, inputs, selects
    const tag = e.target.tagName.toLowerCase();
    const role = e.target.getAttribute('role');
    if (tag === 'input' || tag === 'button' || tag === 'svg' || tag === 'path' || tag === 'select' ||
        role === 'checkbox' || e.target.closest('button') || e.target.closest('[role="checkbox"]')) {
      return;
    }

    isDragging.current = true;
    // Se o item já está selecionado, modo "remover"; senão, modo "adicionar"
    dragMode.current = isSelected ? 'remove' : 'add';

    setSelectedIds(prev => {
      startIdsSnapshot.current = [...prev];
      if (dragMode.current === 'add') {
        return prev.includes(id) ? prev : [...prev, id];
      } else {
        return prev.filter(x => x !== id);
      }
    });

    e.preventDefault(); // Evita seleção de texto
  }, [setSelectedIds]);

  const aplicarSelecao = useCallback((id) => {
    if (!id || !isDragging.current) return;

    setSelectedIds(prev => {
      if (dragMode.current === 'add') {
        return prev.includes(id) ? prev : [...prev, id];
      }
      return prev.filter(x => x !== id);
    });
  }, [setSelectedIds]);

  const onRowMouseEnter = useCallback((id) => {
    aplicarSelecao(id);
  }, [aplicarSelecao]);

  const onMouseMove = useCallback((e) => {
    if (!isDragging.current) return;
    const row = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-drag-select-id]');
    aplicarSelecao(row?.getAttribute('data-drag-select-id'));
  }, [aplicarSelecao]);

  const onMouseUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  // Listener global para soltar o mouse
  useEffect(() => {
    const handler = () => { isDragging.current = false; };
    window.addEventListener('mouseup', handler);
    return () => window.removeEventListener('mouseup', handler);
  }, []);

  return { isDragging, onRowMouseDown, onRowMouseEnter, onMouseMove, onMouseUp };
}