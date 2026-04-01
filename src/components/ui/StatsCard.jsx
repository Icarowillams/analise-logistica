import React from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';

export default function StatsCard({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
  trendValue,
  gradient = 'from-yellow-400 to-amber-500',
  iconBg = 'bg-black/10'
}) {
  const isLightGradient = gradient.includes('yellow') || gradient.includes('amber');
  const textColor = isLightGradient ? 'text-neutral-900' : 'text-white';
  const textMuted = isLightGradient ? 'text-neutral-700' : 'text-white/80';
  const textSubtle = isLightGradient ? 'text-neutral-600' : 'text-white/70';
  const bgOverlay = isLightGradient ? 'bg-black/5' : 'bg-white/10';
  
  return (
    <div className={`relative overflow-hidden rounded-2xl bg-gradient-to-br ${gradient} p-5 sm:p-6 lg:p-7 min-h-[150px] sm:min-h-[170px] ${textColor} shadow-lg`}>
      {/* Background decoration */}
      <div className={`absolute -right-4 sm:-right-6 -top-4 sm:-top-6 h-20 sm:h-32 w-20 sm:w-32 rounded-full ${bgOverlay}`} />
      <div className={`absolute -right-2 sm:-right-3 -top-2 sm:-top-3 h-12 sm:h-20 w-12 sm:w-20 rounded-full ${bgOverlay}`} />
      
      <div className="relative">
        <div className="flex items-start justify-between">
          <div className="min-w-0 flex-1">
            <p className={`text-xs sm:text-sm font-medium ${textMuted} truncate`}>{title}</p>
            <p className="mt-2 text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight truncate">{value}</p>
            {subtitle && (
              <p className={`mt-1 text-xs sm:text-sm ${textSubtle} truncate`}>{subtitle}</p>
            )}
          </div>
          {Icon && (
            <div className={`rounded-xl ${iconBg} p-3 sm:p-4 shrink-0 ml-3`}>
              <Icon className="h-5 w-5 sm:h-6 sm:w-6 lg:h-7 lg:w-7" />
            </div>
          )}
        </div>
        
        {trend !== undefined && (
          <div className="mt-2 sm:mt-4 flex items-center gap-1 sm:gap-2">
            {trend >= 0 ? (
              <TrendingUp className="h-3 w-3 sm:h-4 sm:w-4 text-green-700" />
            ) : (
              <TrendingDown className="h-3 w-3 sm:h-4 sm:w-4 text-red-700" />
            )}
            <span className={`text-[10px] sm:text-sm font-medium ${trend >= 0 ? 'text-green-700' : 'text-red-700'}`}>
              {trend >= 0 ? '+' : ''}{trendValue || trend}%
            </span>
            <span className={`text-[10px] sm:text-sm ${textSubtle} hidden sm:inline`}>vs mês anterior</span>
          </div>
        )}
      </div>
    </div>
  );
}