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
    <div className="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
      <div className="flex items-center gap-4">
        {Icon && (
          <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-yellow-400 to-amber-500 flex items-center justify-center shadow-lg shadow-amber-500/30">
            <Icon className="h-6 w-6 text-neutral-900" />
          </div>
        )}
        <div>
          <h1 className="text-2xl font-bold text-neutral-900 tracking-tight">{title}</h1>
          {subtitle && <p className="text-neutral-500 mt-0.5">{subtitle}</p>}
        </div>
      </div>
      
      {action && (
        <Button
          onClick={action}
          className="bg-gradient-to-r from-yellow-400 to-amber-500 hover:from-yellow-500 hover:to-amber-600 text-neutral-900 font-semibold shadow-lg shadow-amber-500/30 transition-all duration-200"
        >
          <ActionIcon className="w-4 h-4 mr-2" />
          {actionLabel}
        </Button>
      )}
    </div>
  );
}