import React from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';

export default function StatsCard({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
  trendValue,
  gradient = 'from-indigo-500 to-purple-600',
  iconBg = 'bg-white/20'
}) {
  return (
    <div className={`relative overflow-hidden rounded-2xl bg-gradient-to-br ${gradient} p-6 text-white shadow-lg`}>
      {/* Background decoration */}
      <div className="absolute -right-6 -top-6 h-32 w-32 rounded-full bg-white/10" />
      <div className="absolute -right-3 -top-3 h-20 w-20 rounded-full bg-white/10" />
      
      <div className="relative">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm font-medium text-white/80">{title}</p>
            <p className="mt-2 text-3xl font-bold tracking-tight">{value}</p>
            {subtitle && (
              <p className="mt-1 text-sm text-white/70">{subtitle}</p>
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
              <TrendingUp className="h-4 w-4 text-green-300" />
            ) : (
              <TrendingDown className="h-4 w-4 text-red-300" />
            )}
            <span className={`text-sm font-medium ${trend >= 0 ? 'text-green-300' : 'text-red-300'}`}>
              {trend >= 0 ? '+' : ''}{trendValue || trend}%
            </span>
            <span className="text-sm text-white/60">vs mês anterior</span>
          </div>
        )}
      </div>
    </div>
  );
}