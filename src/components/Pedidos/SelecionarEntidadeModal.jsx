import React, { useState, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Search } from 'lucide-react';

export default function SelecionarEntidadeModal({
  open,
  onOpenChange,
  title,
  items,
  selectedIds,
  onConfirm,
  columns,
}) {
  const [search, setSearch] = useState('');
  const [localSelected, setLocalSelected] = useState(selectedIds || []);

  React.useEffect(() => {
    if (open) setLocalSelected(selectedIds || []);
  }, [open, selectedIds]);

  const filtered = useMemo(() => {
    if (!search.trim()) return items;
    const s = search.toLowerCase();
    return items.filter(item =>
      columns.some(col => (item[col.field] || '').toString().toLowerCase().includes(s))
    );
  }, [items, search, columns]);

  const toggle = (id) => {
    setLocalSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const toggleAll = () => {
    const filteredIds = filtered.map(i => i.id);
    const allSelected = filteredIds.every(id => localSelected.includes(id));
    if (allSelected) {
      setLocalSelected(prev => prev.filter(id => !filteredIds.includes(id)));
    } else {
      setLocalSelected(prev => [...new Set([...prev, ...filteredIds])]);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input
            placeholder="Buscar..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>

        <div className="flex-1 overflow-auto border rounded-lg min-h-0">
          <table className="w-full text-sm">
            <thead className="bg-slate-100 sticky top-0">
              <tr>
                <th className="p-2 w-8">
                  <Checkbox
                    checked={filtered.length > 0 && filtered.every(i => localSelected.includes(i.id))}
                    onCheckedChange={toggleAll}
                  />
                </th>
                {columns.map(col => (
                  <th key={col.field} className="p-2 text-left font-medium text-slate-600 text-xs">{col.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(item => (
                <tr key={item.id} className={`border-t hover:bg-slate-50 cursor-pointer ${localSelected.includes(item.id) ? 'bg-amber-50' : ''}`} onClick={() => toggle(item.id)}>
                  <td className="p-2">
                    <Checkbox checked={localSelected.includes(item.id)} onCheckedChange={() => toggle(item.id)} />
                  </td>
                  {columns.map(col => (
                    <td key={col.field} className="p-2 text-xs">{item[col.field] || '-'}</td>
                  ))}
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={columns.length + 1} className="p-4 text-center text-slate-400 text-xs">Nenhum registro encontrado</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="text-xs text-slate-500 mt-1">{localSelected.length} selecionado(s)</div>

        <DialogFooter className="gap-2 mt-2">
          <Button variant="outline" onClick={() => { setLocalSelected([]); onConfirm([]); onOpenChange(false); }}>Limpar</Button>
          <Button onClick={() => { onConfirm(localSelected); onOpenChange(false); }}>Confirmar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}