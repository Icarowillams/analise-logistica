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
          <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/30">
            <Icon className="h-6 w-6 text-white" />
          </div>
        )}
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{title}</h1>
          {subtitle && <p className="text-slate-500 mt-0.5">{subtitle}</p>}
        </div>
      </div>
      
      {action && (
        <Button
          onClick={action}
          className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white shadow-lg shadow-indigo-500/30 transition-all duration-200"
        >
          <ActionIcon className="w-4 h-4 mr-2" />
          {actionLabel}
        </Button>
      )}
    </div>
  );
}