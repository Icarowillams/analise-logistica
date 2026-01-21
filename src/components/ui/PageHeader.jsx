import React from 'react';
import { Button } from '@/components/ui/button';
import { AnimatedBee } from './HoneycombBackground';

export default function PageHeader({ 
  title, 
  subtitle, 
  icon: Icon,
  actionLabel,
  actionIcon: ActionIcon,
  onAction,
  showBee = false
}) {
  return (
    <div className="relative mb-8">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          {/* Ícone hexagonal */}
          <div className="relative">
            <div className="h-16 w-16 flex items-center justify-center">
              {/* Hexágono de fundo */}
              <svg viewBox="0 0 100 115.47" className="absolute inset-0 w-full h-full">
                <defs>
                  <linearGradient id="headerHexGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#fbbf24" />
                    <stop offset="50%" stopColor="#f59e0b" />
                    <stop offset="100%" stopColor="#d97706" />
                  </linearGradient>
                  <filter id="hexShadow" x="-50%" y="-50%" width="200%" height="200%">
                    <feDropShadow dx="0" dy="4" stdDeviation="8" floodColor="#f59e0b" floodOpacity="0.4"/>
                  </filter>
                </defs>
                <polygon 
                  points="50,0 100,28.87 100,86.60 50,115.47 0,86.60 0,28.87"
                  fill="url(#headerHexGradient)"
                  filter="url(#hexShadow)"
                />
              </svg>
              {/* Ícone */}
              {Icon && (
                <Icon className="relative z-10 h-7 w-7 text-amber-950" />
              )}
            </div>
            {/* Abelha decorativa */}
            {showBee && (
              <AnimatedBee className="absolute -top-2 -right-3" />
            )}
          </div>
          
          {/* Textos */}
          <div>
            <h1 className="text-3xl font-black text-neutral-900 tracking-tight">
              {title}
            </h1>
            {subtitle && (
              <p className="text-neutral-500 mt-1 font-medium">
                {subtitle}
              </p>
            )}
          </div>
        </div>
        
        {/* Botão de ação */}
        {actionLabel && (
          <Button 
            onClick={onAction}
            className="bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-amber-950 font-bold shadow-lg shadow-amber-500/30 transition-all hover:shadow-xl hover:shadow-amber-500/40"
          >
            {ActionIcon && <ActionIcon className="w-4 h-4 mr-2" />}
            {actionLabel}
          </Button>
        )}
      </div>
      
      {/* Linha decorativa */}
      <div className="mt-6 h-1 bg-gradient-to-r from-amber-400 via-yellow-400 to-transparent rounded-full opacity-60" />
    </div>
  );
}