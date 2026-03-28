import { NavLink, useLocation } from 'react-router-dom';
import { ThemeToggle } from './ThemeToggle';
import { Database, Table, LineChart } from 'lucide-react';
import { useDataStore } from '@/lib/data-store';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';

const navItems = [
  { path: '/', label: 'Upload', icon: Database, requiresData: false },
  { path: '/overview', label: 'Overview', icon: Table, requiresData: true },
  { path: '/curves', label: 'Curves', icon: LineChart, requiresData: true },
];

export function AppLayout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const hasData = useDataStore(s => !!s.parsedData && !!s.fieldConfig);

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* iOS Liquid Glass Navigation Bar */}
      <header
        className="h-12 flex items-center px-5 gap-4 sticky top-0 z-50"
        style={{
          background: 'hsl(var(--sidebar-background))',
          backdropFilter: 'blur(var(--glass-blur-heavy)) saturate(200%)',
          WebkitBackdropFilter: 'blur(var(--glass-blur-heavy)) saturate(200%)',
          borderBottom: '0.5px solid hsl(var(--sidebar-border))',
          boxShadow: 'var(--shadow-soft)',
        }}
      >
        {/* App Icon — iOS style */}
        <div className="flex items-center gap-2.5 font-semibold text-sm tracking-tight text-foreground">
          <div className="h-7 w-7 rounded-[8px] bg-primary/12 flex items-center justify-center shadow-sm"
            style={{ boxShadow: 'var(--shadow-glass-inset)' }}>
            <Database className="h-3.5 w-3.5 text-primary" />
          </div>
          <span className="font-semibold">DataScope</span>
        </div>

        {/* iOS Segmented Control — Pill Nav */}
        <nav className="flex items-center gap-0.5 ml-5 p-[3px] rounded-full relative"
          style={{
            background: 'hsl(var(--glass-bg))',
            backdropFilter: 'blur(20px)',
            border: '0.5px solid hsl(var(--glass-border-subtle))',
            boxShadow: 'var(--shadow-glass-inset)',
          }}
        >
          {navItems.map(item => {
            const disabled = item.requiresData && !hasData;
            const isActive = location.pathname === item.path;
            return (
              <NavLink
                key={item.path}
                to={disabled ? '#' : item.path}
                onClick={e => disabled && e.preventDefault()}
                className={cn(
                  'relative flex items-center gap-1.5 text-[13px] px-3.5 py-1.5 rounded-full transition-all duration-200',
                  isActive
                    ? 'text-primary font-semibold'
                    : 'text-muted-foreground hover:text-foreground',
                  disabled && 'opacity-25 cursor-not-allowed'
                )}
              >
                {isActive && (
                  <motion.div
                    layoutId="nav-pill"
                    className="absolute inset-0 rounded-full"
                    style={{
                      background: 'hsl(var(--glass-bg-active))',
                      boxShadow: 'var(--shadow-soft), var(--shadow-glass-inset)',
                    }}
                    transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                  />
                )}
                <span className="relative z-10 flex items-center gap-1.5">
                  <item.icon className="h-3.5 w-3.5" />
                  {item.label}
                </span>
              </NavLink>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
        </div>
      </header>
      <main className="flex-1 overflow-hidden">
        {children}
      </main>
    </div>
  );
}
