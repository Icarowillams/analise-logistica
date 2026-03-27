import React, { useEffect, useState } from 'react';
import { CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';

export default function BatchResultToast({ results, onClose }) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(false);
      onClose?.();
    }, 7000);
    return () => clearTimeout(timer);
  }, [onClose]);

  if (!visible || !results) return null;

  return (
    <div className="fixed top-4 right-4 z-50 w-80 bg-white border border-slate-200 rounded-lg shadow-xl p-3 space-y-1.5 animate-in slide-in-from-top-2">
      <p className="text-xs font-semibold text-slate-800 mb-1">{results.title}</p>
      {results.items.map((item, i) => (
        <div key={i} className={`flex items-start gap-2 text-[11px] rounded px-2 py-1 ${item.color === 'green' ? 'bg-green-50 text-green-800' : item.color === 'yellow' ? 'bg-yellow-50 text-yellow-800' : 'bg-red-50 text-red-800'}`}>
          {item.color === 'green' && <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" />}
          {item.color === 'yellow' && <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />}
          {item.color === 'red' && <XCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />}
          <span>{item.text}</span>
        </div>
      ))}
    </div>
  );
}