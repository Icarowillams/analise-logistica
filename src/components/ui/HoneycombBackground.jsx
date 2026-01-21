import React from 'react';

// Componente de fundo com padrão de colmeia animado
export default function HoneycombBackground({ intensity = 'light' }) {
  const opacityClass = intensity === 'strong' ? 'opacity-20' : 'opacity-10';
  
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {/* Padrão de hexágonos SVG */}
      <svg 
        className={`absolute inset-0 w-full h-full ${opacityClass}`}
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <pattern id="honeycomb" width="56" height="100" patternUnits="userSpaceOnUse" patternTransform="scale(1.5)">
            <path 
              d="M28 66L0 50L0 16L28 0L56 16L56 50L28 66L28 100" 
              fill="none" 
              stroke="#f59e0b" 
              strokeWidth="1"
            />
            <path 
              d="M28 0L28 34L0 50L0 84L28 100L56 84L56 50L28 34" 
              fill="none" 
              stroke="#f59e0b" 
              strokeWidth="1"
            />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#honeycomb)" />
      </svg>
      
      {/* Gotas de mel decorativas */}
      <div className="absolute top-20 right-10 w-32 h-32 bg-gradient-to-br from-amber-300/20 to-yellow-500/10 rounded-full blur-3xl animate-pulse" />
      <div className="absolute bottom-40 left-20 w-48 h-48 bg-gradient-to-br from-yellow-400/15 to-orange-400/10 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
      <div className="absolute top-1/2 right-1/4 w-24 h-24 bg-gradient-to-br from-amber-500/20 to-yellow-600/10 rounded-full blur-2xl animate-pulse" style={{ animationDelay: '2s' }} />
    </div>
  );
}

// Hexágono individual para uso em cards
export function Hexagon({ className = '', filled = false, size = 'md' }) {
  const sizes = {
    sm: 'w-8 h-9',
    md: 'w-12 h-14',
    lg: 'w-16 h-18',
    xl: 'w-24 h-28'
  };
  
  return (
    <svg 
      viewBox="0 0 100 115.47" 
      className={`${sizes[size]} ${className}`}
    >
      <polygon 
        points="50,0 100,28.87 100,86.60 50,115.47 0,86.60 0,28.87"
        fill={filled ? 'url(#honeyGradient)' : 'none'}
        stroke="currentColor"
        strokeWidth="2"
      />
      <defs>
        <linearGradient id="honeyGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#fbbf24" />
          <stop offset="50%" stopColor="#f59e0b" />
          <stop offset="100%" stopColor="#d97706" />
        </linearGradient>
      </defs>
    </svg>
  );
}

// Componente de abelha animada
export function AnimatedBee({ className = '' }) {
  return (
    <div className={`relative ${className}`}>
      <svg viewBox="0 0 64 64" className="w-8 h-8 animate-bounce" style={{ animationDuration: '2s' }}>
        {/* Corpo */}
        <ellipse cx="32" cy="32" rx="16" ry="12" fill="#fbbf24" />
        <ellipse cx="32" cy="32" rx="16" ry="12" fill="url(#beeStripes)" />
        {/* Cabeça */}
        <circle cx="50" cy="32" r="8" fill="#1a1a1a" />
        {/* Asas */}
        <ellipse cx="28" cy="20" rx="10" ry="6" fill="rgba(255,255,255,0.6)" className="animate-pulse" />
        <ellipse cx="28" cy="44" rx="10" ry="6" fill="rgba(255,255,255,0.6)" className="animate-pulse" />
        {/* Ferrão */}
        <polygon points="14,32 8,32 12,30" fill="#1a1a1a" />
        <defs>
          <pattern id="beeStripes" patternUnits="userSpaceOnUse" width="8" height="24">
            <rect width="8" height="4" fill="#1a1a1a" y="0" />
            <rect width="8" height="4" fill="transparent" y="4" />
            <rect width="8" height="4" fill="#1a1a1a" y="8" />
            <rect width="8" height="4" fill="transparent" y="12" />
            <rect width="8" height="4" fill="#1a1a1a" y="16" />
            <rect width="8" height="4" fill="transparent" y="20" />
          </pattern>
        </defs>
      </svg>
    </div>
  );
}