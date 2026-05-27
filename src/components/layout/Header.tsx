'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { Menu, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, usePathname, useRouter } from '@/i18n/routing';
import { cn } from '@/lib/utils';

const NAV_ITEMS = [
  { href: '/#simulate', key: 'nav_simulate' as const },
  { href: '/backtest', key: 'backtest' as const, label: 'Backtest' },
  { href: '/demo', key: 'nav_demo' as const },
  { href: '/methodology', key: 'nav_methodology' as const },
] as const;

export function Header() {
  const t = useTranslations('header');
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [menuOpen]);

  const switchLocale = (to: 'es' | 'en') => {
    router.replace(pathname, { locale: to });
  };

  const navLink = (href: string, label: string, mobile = false) => {
    const path = href.split('#')[0] || '/';
    const active = path === '/' ? pathname === '/' : pathname === path || pathname.startsWith(`${path}/`);

    return (
      <Link
        href={href}
        onClick={() => setMenuOpen(false)}
        className={cn(
          'font-medium transition-colors',
          mobile
            ? 'block rounded-xl px-4 py-3 text-base'
            : 'text-sm',
          active ? 'text-gold' : 'text-fg-0/85 hover:text-gold',
          mobile && !active && 'text-fg-1 hover:bg-bg-1/60',
          mobile && active && 'bg-gold/10',
        )}
      >
        {label}
      </Link>
    );
  };

  return (
    <header
      className={cn(
        'fixed inset-x-0 top-0 z-50 transition-all duration-300',
        scrolled ? 'py-2' : 'py-3 sm:py-4',
      )}
    >
      <div
        className={cn(
          'mx-auto flex max-w-[1440px] items-center justify-between gap-2 rounded-full border px-3 transition-all duration-300 sm:gap-6 sm:px-5',
          scrolled
            ? 'glass mx-3 h-12 border-border sm:mx-4'
            : 'mx-3 h-12 border-transparent sm:mx-6 sm:h-14',
        )}
      >
        <Link href="/" className="group flex min-w-0 flex-1 items-center gap-2 sm:flex-initial sm:gap-2.5">
          <Image
            src="/logo-worldcup2026.webp"
            alt="FIFA World Cup 2026"
            width={250}
            height={386}
            priority
            className={cn(
              'h-7 w-auto shrink-0 object-contain transition-transform group-hover:scale-105 sm:h-9',
            )}
          />
          <span className="hidden truncate text-sm font-medium tracking-wide text-fg-0 min-[420px]:inline sm:max-w-none">
            {t('brand')}
          </span>
        </Link>

        <nav className="hidden items-center gap-7 text-sm md:flex">
          {NAV_ITEMS.map((item) =>
            navLink(item.href, 'label' in item ? item.label : t(item.key)),
          )}
        </nav>

        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <div className="flex items-center gap-0.5 rounded-full border border-border bg-bg-1/40 p-0.5">
            <button
              onClick={() => switchLocale('es')}
              className={cn(
                'rounded-full px-2 py-1 text-xs font-medium transition-colors sm:px-3',
                locale === 'es' ? 'bg-gold text-bg-0' : 'text-fg-0/80 hover:text-fg-0',
              )}
              aria-label="Español"
            >
              {t('lang_es')}
            </button>
            <button
              onClick={() => switchLocale('en')}
              className={cn(
                'rounded-full px-2 py-1 text-xs font-medium transition-colors sm:px-3',
                locale === 'en' ? 'bg-gold text-bg-0' : 'text-fg-0/80 hover:text-fg-0',
              )}
              aria-label="English"
            >
              {t('lang_en')}
            </button>
          </div>

          <button
            type="button"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-bg-1/40 text-fg-0 md:hidden"
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          >
            {menuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {menuOpen && (
        <>
          <button
            type="button"
            className="fixed inset-0 top-14 z-40 bg-bg-0/60 backdrop-blur-sm md:hidden"
            aria-label="Close menu"
            onClick={() => setMenuOpen(false)}
          />
          <nav
            className="glass absolute inset-x-3 top-[calc(100%+0.5rem)] z-50 rounded-2xl border border-border p-2 shadow-card md:hidden"
            aria-label="Mobile navigation"
          >
            {NAV_ITEMS.map((item) =>
              navLink(
                item.href,
                'label' in item ? item.label : t(item.key),
                true,
              ),
            )}
          </nav>
        </>
      )}
    </header>
  );
}
