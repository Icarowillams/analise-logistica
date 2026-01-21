import React from 'react';
import { cn } from '@/lib/utils';

// Card estilizado com visual de colmeia
export function HoneyCard({ 
  children, 
  className = '', 
  variant = 'default',
  hover = true,
  glow = false 
}) {
  const variants = {
    default: 'bg-white/95 backdrop-blur-sm border-amber-200/50',
    honey: 'bg-gradient-to-br from-amber-50 to-yellow-50 border-amber-300/50',
    dark: 'bg-neutral-900 border-amber-500/20 text-white',
    glass: 'bg-white/70 backdrop-blur-md border-amber-200/30'
  };

  return (
    <div className={cn(
      'relative overflow-hidden rounded-2xl border shadow-lg',
      variants[variant],
      hover && 'transition-all duration-300 hover:shadow-xl hover:-translate-y-0.5',
      glow && 'shadow-amber-500/10 hover:shadow-amber-500/20',
      className
    )}>
      {/* Decoração hexagonal sutil */}
      <svg className="absolute -right-6 -top-6 w-32 h-36 opacity-[0.03] pointer-events-none" viewBox="0 0 100 115.47">
        <polygon 
          points="50,0 100,28.87 100,86.60 50,115.47 0,86.60 0,28.87"
          fill="currentColor"
        />
      </svg>
      
      {children}
    </div>
  );
}

export function HoneyCardHeader({ children, className = '' }) {
  return (
    <div className={cn(
      'flex flex-col space-y-1.5 p-6 border-b border-amber-200/30',
      className
    )}>
      {children}
    </div>
  );
}

export function HoneyCardTitle({ children, className = '', icon: Icon }) {
  return (
    <div className={cn('flex items-center gap-3', className)}>
      {Icon && (
        <div className="p-2 rounded-xl bg-gradient-to-br from-amber-400 to-amber-500 shadow-lg shadow-amber-500/30">
          <Icon className="w-5 h-5 text-amber-950" />
        </div>
      )}
      <h3 className="text-xl font-bold text-neutral-800 tracking-tight">{children}</h3>
    </div>
  );
}

export function HoneyCardContent({ children, className = '' }) {
  return (
    <div className={cn('p-6', className)}>
      {children}
    </div>
  );
}

export function HoneyCardDescription({ children, className = '' }) {
  return (
    <p className={cn('text-sm text-neutral-500 mt-1', className)}>
      {children}
    </p>
  );
}