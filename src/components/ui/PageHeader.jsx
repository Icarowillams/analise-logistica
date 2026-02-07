import React from 'react';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';

export default function PageHeader({
  title,
  subtitle,
  icon: Icon,
  action,
  actionLabel = 'Novo',
  actionIcon: ActionIcon = Plus
}) {
  return (
    <div className="mb-6 sm:mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
      <div className="flex items-center gap-3 sm:gap-4">
        {Icon && (
          <div className="h-10 w-10 sm:h-12 sm:w-12 rounded-xl bg-gradient-to-br from-yellow-400 to-amber-500 flex items-center justify-center shadow-lg shadow-amber-500/30 shrink-0">
            <Icon className="h-5 w-5 sm:h-6 sm:w-6 text-neutral-900" />
          </div>
        )}
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-neutral-900 tracking-tight truncate">{title}</h1>
          {subtitle && <p className="text-xs sm:text-sm text-neutral-500 mt-0.5 truncate">{subtitle}</p>}
        </div>
      </div>
      
      {action && (
        <Button
          onClick={action}
          size="sm"
          className="bg-gradient-to-r from-yellow-400 to-amber-500 hover:from-yellow-500 hover:to-amber-600 text-neutral-900 font-semibold shadow-lg shadow-amber-500/30 transition-all duration-200 self-end sm:self-auto text-xs sm:text-sm"
        >
          <ActionIcon className="w-3 h-3 sm:w-4 sm:h-4 mr-1 sm:mr-2" />
          {actionLabel}
        </Button>
      )}
    </div>
  );
}