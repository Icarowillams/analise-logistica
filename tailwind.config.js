/** @type {import('tailwindcss').Config} */
module.exports = {
    darkMode: ["class"],
    content: ["./index.html", "./src/**/*.{ts,tsx,js,jsx}"],
  theme: {
  	extend: {
  		borderRadius: {
  			lg: 'var(--radius)',
  			md: 'calc(var(--radius) - 2px)',
  			sm: 'calc(var(--radius) - 4px)'
  		},
  		colors: {
  			background: 'hsl(var(--background))',
  			foreground: 'hsl(var(--foreground))',
  			card: {
  				DEFAULT: 'hsl(var(--card))',
  				foreground: 'hsl(var(--card-foreground))'
  			},
  			popover: {
  				DEFAULT: 'hsl(var(--popover))',
  				foreground: 'hsl(var(--popover-foreground))'
  			},
  			primary: {
  				DEFAULT: 'hsl(var(--primary))',
  				foreground: 'hsl(var(--primary-foreground))'
  			},
  			secondary: {
  				DEFAULT: 'hsl(var(--secondary))',
  				foreground: 'hsl(var(--secondary-foreground))'
  			},
  			muted: {
  				DEFAULT: 'hsl(var(--muted))',
  				foreground: 'hsl(var(--muted-foreground))'
  			},
  			accent: {
  				DEFAULT: 'hsl(var(--accent))',
  				foreground: 'hsl(var(--accent-foreground))'
  			},
  			destructive: {
  				DEFAULT: 'hsl(var(--destructive))',
  				foreground: 'hsl(var(--destructive-foreground))'
  			},
  			border: 'hsl(var(--border))',
  			input: 'hsl(var(--input))',
  			ring: 'hsl(var(--ring))',
  			chart: {
  				'1': 'hsl(var(--chart-1))',
  				'2': 'hsl(var(--chart-2))',
  				'3': 'hsl(var(--chart-3))',
  				'4': 'hsl(var(--chart-4))',
  				'5': 'hsl(var(--chart-5))'
  			},
  			sidebar: {
  				DEFAULT: 'hsl(var(--sidebar-background))',
  				foreground: 'hsl(var(--sidebar-foreground))',
  				primary: 'hsl(var(--sidebar-primary))',
  				'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
  				accent: 'hsl(var(--sidebar-accent))',
  				'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
  				border: 'hsl(var(--sidebar-border))',
  				ring: 'hsl(var(--sidebar-ring))'
  			}
  		},
  		keyframes: {
  			'accordion-down': {
  				from: {
  					height: '0'
  				},
  				to: {
  					height: 'var(--radix-accordion-content-height)'
  				}
  			},
  			'accordion-up': {
  				from: {
  					height: 'var(--radix-accordion-content-height)'
  				},
  				to: {
  					height: '0'
  				}
  			}
  		},
  		animation: {
  			'accordion-down': 'accordion-down 0.2s ease-out',
  			'accordion-up': 'accordion-up 0.2s ease-out'
  		}
  	}
  },
  safelist: [
    'bg-blue-100', 'text-blue-800', 'border-blue-300', 'bg-blue-500',
    'bg-red-100', 'text-red-800', 'border-red-300', 'bg-red-500',
    'bg-orange-100', 'text-orange-800', 'border-orange-300', 'bg-orange-500',
    'bg-green-100', 'text-green-800', 'border-green-300', 'bg-green-500',
    'bg-yellow-100', 'text-yellow-800', 'border-yellow-300', 'bg-yellow-500',
    'bg-gray-200', 'text-gray-800', 'border-gray-400', 'bg-gray-700',
    'bg-purple-100', 'text-purple-800', 'border-purple-300',
    'border-emerald-200', 'text-emerald-500', 'text-emerald-600',
    'border-amber-200', 'text-amber-500', 'text-amber-600',
    'border-purple-200', 'text-purple-500', 'text-purple-600',
    'border-blue-200', 'text-blue-500', 'text-blue-600',
    // Operação Kanban — cores dinâmicas
    'bg-amber-50', 'bg-amber-100', 'bg-amber-200', 'bg-amber-500', 'bg-amber-600', 'text-amber-700', 'text-amber-800', 'border-amber-200',
    'bg-blue-50', 'bg-blue-200', 'bg-blue-600', 'text-blue-700', 'border-blue-200',
    'bg-orange-50', 'bg-orange-100', 'bg-orange-200', 'bg-orange-500', 'bg-orange-600', 'text-orange-700', 'border-orange-200',
    'bg-emerald-50', 'bg-emerald-100', 'bg-emerald-200', 'bg-emerald-500', 'bg-emerald-600', 'text-emerald-700', 'text-emerald-800', 'border-emerald-200',
    'bg-indigo-50', 'bg-indigo-100', 'bg-indigo-200', 'bg-indigo-500', 'bg-indigo-600', 'text-indigo-700', 'text-indigo-800', 'border-indigo-200',
    'bg-slate-50', 'bg-slate-200', 'text-slate-800',
    'bg-red-50', 'bg-red-100', 'bg-red-200', 'border-red-200', 'text-red-700', 'text-red-800',
  ],
  plugins: [require("tailwindcss-animate")],
}