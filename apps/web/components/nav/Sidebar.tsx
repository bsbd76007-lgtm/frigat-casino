'use client';

import { useCallback, useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { GAME_ICONS } from '@/components/icons';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CrownIcon,
  GiftIcon,
  GridIcon,
  HeadphonesIcon,
  ShieldCheckIcon,
  UserPlusIcon,
} from '@/components/icons/ui';
import { useLanguage } from '@/components/providers/LanguageProvider';

import { openPanel } from '@/lib/appPanels';
import { NAV_GROUPS } from '@/lib/navigation';

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

const RAIL_ICON_PX = 18;

const COLLAPSE_KEY = 'frigat.rail.collapsed';

export function Sidebar({ open, onClose }: SidebarProps) {
  const pathname = usePathname();
  const { t } = useLanguage();

  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === '1');
    } catch {
    }
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
      } catch {
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const mobile = window.matchMedia('(max-width: 1024px)').matches;
    if (!mobile) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  return (
    <>
      {open && <div className="rail__scrim" onClick={onClose} aria-hidden="true" />}

      <aside
        className={`rail${open ? ' rail--open' : ''}${collapsed ? ' rail--mini' : ''}`}
        aria-label={t('nav.aria')}
      >
        <Link className="rail__brand" href="/" onClick={onClose} aria-label={t('nav.homeAria')}>
          <Image
            src="/frigat-monogram.png"
            alt=""
            width={400}
            height={345}
            className="rail__mark"
          />
          <span className="rail__word">Frigat</span>
        </Link>

        <div className="rail__scroll">
          <nav className="rail__section">
            <RailLink
              href="/"
              active={pathname === '/'}
              onNavigate={onClose}
              icon={<RailIcon name="casino" />}
              label="Casino"
            />
            <RailLink
              href="/vip"
              active={pathname === '/vip'}
              onNavigate={onClose}
              icon={<RailIcon name="vip" />}
              label="VIP Club"
            />
            <RailLink
              href="/referrals"
              active={pathname === '/referrals'}
              onNavigate={onClose}
              icon={<RailIcon name="referrals" />}
              label={t('nav.referrals')}
            />
            <RailLink
              href="/bonuses"
              active={pathname === '/bonuses'}
              onNavigate={onClose}
              icon={<RailIcon name="rewards" />}
              label={t('nav.bonuses')}
            />
            <RailLink
              href="/architecture"
              active={pathname === '/architecture'}
              onNavigate={onClose}
              icon={<RailIcon name="architecture" />}
              label={t('nav.architecture')}
            />
          </nav>

          <div className="rail__divider" />

          {NAV_GROUPS.map((group) => (
            <div className="rail__group" key={group.id}>
              <p className="rail__heading">{group.label}</p>
              <nav className="rail__section">
                {group.games.map((game) => {
                  const href = `/games/${game.slug}`;
                  const Icon = GAME_ICONS[game.slug as keyof typeof GAME_ICONS];
                  return (
                    <RailLink
                      key={game.slug}
                      href={href}
                      active={pathname === href}
                      onNavigate={onClose}
                      icon={
                        <span className="rail__game-icon">
                          {Icon ? <Icon size={18} /> : null}
                        </span>
                      }
                      label={t(game.labelKey)}
                    />
                  );
                })}
              </nav>
            </div>
          ))}
        </div>

        <div className="rail__foot">
          <button
            type="button"
            className="rail__link rail__link--support"
            title={t('support.open')}
            onClick={() => {
              openPanel('support');
              onClose();
            }}
          >
            <RailIcon name="support" />
            <span className="rail__label">{t('support.open')}</span>
          </button>

          <button
            type="button"
            className="rail__collapse"
            onClick={toggleCollapsed}
            aria-pressed={collapsed}
            title={collapsed ? t('nav.expandMenu') : t('nav.collapseMenu')}
            aria-label={collapsed ? t('nav.expandMenu') : t('nav.collapseMenu')}
          >
            {collapsed ? (
              <ChevronRightIcon size={RAIL_ICON_PX} aria-hidden="true" />
            ) : (
              <ChevronLeftIcon size={RAIL_ICON_PX} aria-hidden="true" />
            )}
            <span className="rail__label">{t('nav.collapse')}</span>
          </button>
        </div>
      </aside>
    </>
  );
}

type RailIconName = keyof typeof RAIL_ICONS;

const RAIL_ICONS = {
  casino: GridIcon,
  vip: CrownIcon,
  referrals: UserPlusIcon,
  rewards: GiftIcon,
  architecture: ShieldCheckIcon,
  support: HeadphonesIcon,
} as const;

function RailLink({
  href,
  active,
  onNavigate,
  icon,
  label,
}: {
  href: string;
  active: boolean;
  onNavigate: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <Link
      href={href}
      className={`rail__link${active ? ' rail__link--on' : ''}`}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      title={label}
    >
      {icon}
      <span className="rail__label">{label}</span>
    </Link>
  );
}

function RailIcon({ name }: { name: RailIconName }) {
  const Icon = RAIL_ICONS[name];
  return <Icon size={RAIL_ICON_PX} aria-hidden="true" />;
}

export default Sidebar;
