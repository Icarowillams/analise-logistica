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
    <div className={`relative overflow-hidden rounded-2xl bg-gradient-to-br ${gradient} p-6 ${textColor} shadow-lg`}>
      {/* Background decoration */}
      <div className={`absolute -right-6 -top-6 h-32 w-32 rounded-full ${bgOverlay}`} />
      <div className={`absolute -right-3 -top-3 h-20 w-20 rounded-full ${bgOverlay}`} />
      
      <div className="relative">
        <div className="flex items-start justify-between">
          <div>
            <p className={`text-sm font-medium ${textMuted}`}>{title}</p>
            <p className="mt-2 text-3xl font-bold tracking-tight">{value}</p>
            {subtitle && (
              <p className={`mt-1 text-sm ${textSubtle}`}>{subtitle}</p>
            )}
          </div>
          {Icon && (
            <div className={`rounded-xl ${iconBg} p-3`}>
              <Icon className="h-6 w-6" />
            </div>
          )}
        </div>
        
        {trend !== undefined && (
          <div className="mt-4 flex items-center gap-2">
            {trend >= 0 ? (
              <TrendingUp className="h-4 w-4 text-green-700" />
            ) : (
              <TrendingDown className="h-4 w-4 text-red-700" />
            )}
            <span className={`text-sm font-medium ${trend >= 0 ? 'text-green-700' : 'text-red-700'}`}>
              {trend >= 0 ? '+' : ''}{trendValue || trend}%
            </span>
            <span className={`text-sm ${textSubtle}`}>vs mês anterior</span>
          </div>
        )}
      </div>
    </div>
  );
}