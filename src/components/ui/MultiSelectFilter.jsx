import React, { useState, useMemo } from 'react';
import { Check, ChevronDown, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';

export default function MultiSelectFilter({ 
  label, 
  options = [], 
  selectedIds = [], 
  onChange, 
  placeholder = "Todos",
  includeEmpty = false,
  emptyLabel = "Vazio / Sem valor"
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const filteredOptions = useMemo(() => {
    if (!search) return options;
    return options.filter(opt => 
      opt.nome?.toLowerCase().includes(search.toLowerCase())
    );
  }, [options, search]);

  const handleToggle = (id) => {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter(i => i !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  };

  const handleSelectAll = () => {
    if (selectedIds.length === options.length + (includeEmpty ? 1 : 0)) {
      onChange([]);
    } else {
      const allIds = options.map(o => o.id);
      if (includeEmpty) allIds.push('__empty__');
      onChange(allIds);
    }
  };

  const handleClear = () => {
    onChange([]);
  };

  const getDisplayText = () => {
    if (selectedIds.length === 0) return placeholder;
    if (selectedIds.length === 1) {
      if (selectedIds[0] === '__empty__') return emptyLabel;
      const opt = options.find(o => o.id === selectedIds[0]);
      return opt?.nome || placeholder;
    }
    return `${selectedIds.length} selecionados`;
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal h-10"
        >
          <span className="truncate">{getDisplayText()}</span>
          <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <div className="p-2 border-b">
          <Input
            placeholder="Buscar..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8"
          />
        </div>
        
        <div className="p-2 border-b flex gap-2">
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={handleSelectAll}
            className="flex-1 h-7 text-xs"
          >
            Selecionar Todos
          </Button>
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={handleClear}
            className="flex-1 h-7 text-xs"
          >
            Limpar
          </Button>
        </div>

        <ScrollArea className="h-[200px]">
          <div className="p-2 space-y-1">
            {includeEmpty && (
              <div
                className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-slate-100 cursor-pointer"
                onClick={() => handleToggle('__empty__')}
              >
                <Checkbox 
                  checked={selectedIds.includes('__empty__')} 
                  className="pointer-events-none"
                />
                <span className="text-sm text-amber-600">🔍 {emptyLabel}</span>
              </div>
            )}
            {filteredOptions.map((option) => (
              <div
                key={option.id}
                className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-slate-100 cursor-pointer"
                onClick={() => handleToggle(option.id)}
              >
                <Checkbox 
                  checked={selectedIds.includes(option.id)} 
                  className="pointer-events-none"
                />
                <span className="text-sm truncate">{option.nome}</span>
              </div>
            ))}
            {filteredOptions.length === 0 && !includeEmpty && (
              <p className="text-sm text-slate-500 text-center py-4">Nenhum item encontrado</p>
            )}
          </div>
        </ScrollArea>

        {selectedIds.length > 0 && (
          <div className="p-2 border-t bg-slate-50">
            <div className="flex flex-wrap gap-1">
              {selectedIds.slice(0, 3).map(id => {
                const opt = id === '__empty__' ? { nome: emptyLabel } : options.find(o => o.id === id);
                return (
                  <Badge key={id} variant="secondary" className="text-xs">
                    {opt?.nome?.substring(0, 15) || id}
                    {opt?.nome?.length > 15 ? '...' : ''}
                  </Badge>
                );
              })}
              {selectedIds.length > 3 && (
                <Badge variant="secondary" className="text-xs">
                  +{selectedIds.length - 3}
                </Badge>
              )}
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}