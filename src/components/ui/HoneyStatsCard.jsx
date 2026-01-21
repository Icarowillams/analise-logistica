import React from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';

// Card de estatísticas com visual de colmeia
export default function HoneyStatsCard({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
  trendValue,
  variant = 'honey', // honey, dark, amber, golden
  className = ''
}) {
  const variants = {
    honey: {
      bg: 'bg-gradient-to-br from-amber-400 via-yellow-400 to-amber-500',
      text: 'text-amber-950',
      muted: 'text-amber-900/80',
      subtle: 'text-amber-800/70',
      iconBg: 'bg-amber-950/10',
      accent: 'bg-amber-600/20',
      border: 'border-amber-300/50'
    },
    dark: {
      bg: 'bg-gradient-to-br from-neutral-800 via-neutral-900 to-neutral-950',
      text: 'text-amber-100',
      muted: 'text-amber-200/80',
      subtle: 'text-amber-300/60',
      iconBg: 'bg-amber-500/20',
      accent: 'bg-amber-500/10',
      border: 'border-amber-500/20'
    },
    amber: {
      bg: 'bg-gradient-to-br from-amber-500 via-orange-500 to-amber-600',
      text: 'text-white',
      muted: 'text-white/90',
      subtle: 'text-white/70',
      iconBg: 'bg-white/20',
      accent: 'bg-white/10',
      border: 'border-white/20'
    },
    golden: {
      bg: 'bg-gradient-to-br from-yellow-300 via-amber-300 to-yellow-400',
      text: 'text-amber-900',
      muted: 'text-amber-800/80',
      subtle: 'text-amber-700/70',
      iconBg: 'bg-amber-800/10',
      accent: 'bg-amber-700/10',
      border: 'border-amber-500/30'
    }
  };

  const style = variants[variant];

  return (
    <div className={`
      relative overflow-hidden rounded-2xl ${style.bg} p-6 
      shadow-xl shadow-amber-500/10 
      border ${style.border}
      transition-all duration-300 hover:shadow-2xl hover:shadow-amber-500/20 hover:-translate-y-1
      ${className}
    `}>
      {/* Padrão de hexágono no fundo */}
      <svg className="absolute -right-8 -top-8 w-40 h-40 opacity-10" viewBox="0 0 100 115.47">
        <polygon 
          points="50,0 100,28.87 100,86.60 50,115.47 0,86.60 0,28.87"
          fill="currentColor"
        />
      </svg>
      <svg className="absolute -right-4 -top-4 w-24 h-28 opacity-5" viewBox="0 0 100 115.47">
        <polygon 
          points="50,0 100,28.87 100,86.60 50,115.47 0,86.60 0,28.87"
          fill="currentColor"
        />
      </svg>
      
      {/* Decoração de gota de mel */}
      <div className={`absolute -bottom-6 -left-6 w-20 h-20 rounded-full ${style.accent} blur-xl`} />
      
      <div className="relative z-10">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <p className={`text-sm font-semibold uppercase tracking-wider ${style.muted}`}>
              {title}
            </p>
            <p className={`mt-3 text-4xl font-black tracking-tight ${style.text}`}>
              {value}
            </p>
            {subtitle && (
              <p className={`mt-2 text-sm font-medium ${style.subtle}`}>
                {subtitle}
              </p>
            )}
          </div>
          {Icon && (
            <div className={`rounded-xl ${style.iconBg} p-3.5 backdrop-blur-sm`}>
              <Icon className={`h-7 w-7 ${style.text}`} />
            </div>
          )}
        </div>
        
        {trend !== undefined && (
          <div className="mt-4 flex items-center gap-2">
            <div className={`flex items-center gap-1 px-2 py-1 rounded-full ${trend >= 0 ? 'bg-green-500/20' : 'bg-red-500/20'}`}>
              {trend >= 0 ? (
                <TrendingUp className="h-4 w-4 text-green-600" />
              ) : (
                <TrendingDown className="h-4 w-4 text-red-600" />
              )}
              <span className={`text-sm font-bold ${trend >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                {trend >= 0 ? '+' : ''}{trendValue || trend}%
              </span>
            </div>
            <span className={`text-xs ${style.subtle}`}>vs período anterior</span>
          </div>
        )}
      </div>
    </div>
  );
}