import { useState, useCallback, useRef } from 'react';

const STORAGE_KEY = 'gerenciar-pedidos-col-widths-v1';

function loadWidths() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : {};
  } catch {
    return {};
  }
}

function saveWidths(widths) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(widths));
}

export default function useColumnResize() {
  const [colWidths, setColWidths] = useState(() => loadWidths());
  const resizeRef = useRef(null);

  const onResizeStart = useCallback((e, colId, startWidth) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const w = startWidth || 120;

    const onMouseMove = (moveE) => {
      const delta = moveE.clientX - startX;
      const newWidth = Math.max(50, w + delta);
      setColWidths(prev => {
        const updated = { ...prev, [colId]: newWidth };
        saveWidths(updated);
        return updated;
      });
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, []);

  return { colWidths, onResizeStart };
}