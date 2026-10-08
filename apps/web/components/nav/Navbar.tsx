'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { useGameSocket } from '@/components/providers/GameSocketProvider';
import { useLanguage } from '@/components/providers/LanguageProvider';
import { ThemeToggle } from '@/components/nav/ThemeToggle';
import { PlayersOnline } from '@/components/feed/PlayersOnline';
import { HeaderSearch } from '@/components/nav/HeaderSearch';
import WalletModal, { type WalletTab } from '@/components/modals/WalletModal';
import DepositModal from '@/components/modals/DepositModal';
import { LanguageSwitcher } from '@/components/nav/LanguageSwitcher';
import WithdrawModal from '@/components/modals/WithdrawModal';
import AccountModal from '@/components/modals/AccountModal';
import AuthModal from '@/components/auth/AuthModal';

import { useScrollDirection } from '@/hooks/useScrollDirection';
import { subscribeToPanels } from '@/lib/appPanels';

const STATUS_CLASS: Record<string, string> = {
  open: 'dash__status dash__status--open',
  connecting: 'dash__status dash__status--pending',
  reconnecting: 'dash__status dash__status--pending',
  unauthorized: 'dash__status dash__status--down',
  closed: 'dash__status dash__status--down',
  idle: 'dash__status',
};

interface NavbarProps {
  onMenuToggle?: () => void;
  menuOpen?: boolean;
  inGame?: boolean;
}

export function Navbar({ onMenuToggle, menuOpen, inGame = false }: NavbarProps) {
  const { balance, socket, setFairnessOpen, token, setToken } = useGameSocket();
  const { t } = useLanguage();
  const router = useRouter();
  const visible = useScrollDirection();

  const [walletOpen, setWalletOpen] = useState(false);
  const [walletTab, setWalletTab] = useState<WalletTab>('deposit');
  const [accountOpen, setAccountOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);

  const openWallet = (tab: WalletTab) => {
    setWalletTab(tab);
    setWalletOpen(true);
  };

  useEffect(
    () =>
      subscribeToPanels((panel) => {
        if (panel === 'deposit' || panel === 'withdraw') openWallet(panel);
      }),
    []
  );

  const signOut = async () => {
    setToken(null);
    try {
      await fetch('/api/session', { method: 'DELETE' });
    } catch {
    }
    router.replace('/login');
  };

  return (
    <header
      className={
        inGame
          ? `dash__header dash__header--game${visible ? '' : ' dash__header--tucked'}`
          : 'dash__header'
      }
    >
      <button
        type="button"
        className="dash__burger"
        onClick={onMenuToggle}
        aria-label={t('nav.toggle')}
        aria-expanded={menuOpen}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>

      <Link className="dash__brand" href="/" aria-label={t('nav.homeAria')}>
        <Image
          src="/frigat-monogram.png"
          alt=""
          width={400}
          height={345}
          priority
          className="dash__mark"
        />
        <span className="dash__word">Frigat</span>
      </Link>

      <HeaderSearch />

      <PlayersOnline />

      <div className="dash__right">
        {!token ? (
          <>
            <LanguageSwitcher />
            <ThemeToggle />
            <Link className="dash__btn" href="/login">
              {t('header.login')}
            </Link>
            <Link className="dash__cta" href="/register">
              {t('header.register')}
            </Link>
            <button
              type="button"
              className="dash__avatar"
              onClick={() => setAuthOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={authOpen}
              aria-label={t('header.login')}
              title={t('header.login')}
            >
              <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
                <path
                  d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-4 0-7 2.2-7 5v1h14v-1c0-2.8-3-5-7-5Z"
                  fill="currentColor"
                />
              </svg>
            </button>
          </>
        ) : (
          <>
            <span
              className={STATUS_CLASS[socket.status] ?? 'dash__status'}
              role="status"
              aria-label={t('header.connection', { status: socket.status })}
              title={t('header.socket', { status: socket.status })}
            />
            <button
              type="button"
              className="dash__balance dash__balance--action"
              onClick={() => openWallet('deposit')}
              aria-haspopup="dialog"
              aria-label={t('header.deposit')}
            >
              <b>{balance.hasSynced ? balance.formatted : '—'}</b>
              <span>{balance.currency}</span>
            </button>

            <LanguageSwitcher />
            <ThemeToggle />

            <button
              type="button"
              className="dash__btn dash__btn--fair"
              onClick={() => setFairnessOpen(true)}
            >
              {t('header.provablyFair')}
            </button>
            <button
              type="button"
              className="dash__cta"
              onClick={() => openWallet('deposit')}
            >
              {t('header.deposit')}
            </button>

            <button
              type="button"
              className="dash__avatar"
              onClick={() => setAccountOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={accountOpen}
              aria-label={t('account.open')}
              title={t('account.open')}
            >
              <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
                <path
                  d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-4 0-7 2.2-7 5v1h14v-1c0-2.8-3-5-7-5Z"
                  fill="currentColor"
                />
              </svg>
            </button>
          </>
        )}
      </div>

      <WalletModal
        open={walletOpen}
        tab={walletTab}
        onTabChange={setWalletTab}
        onClose={() => setWalletOpen(false)}
      >
        {walletTab === 'deposit' ? (
          <DepositModal open={walletOpen} />
        ) : (
          <WithdrawModal open={walletOpen} onClose={() => setWalletOpen(false)} />
        )}
      </WalletModal>

      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />

      <AccountModal
        open={accountOpen}
        onClose={() => setAccountOpen(false)}
        onSignOut={() => void signOut()}
      />
    </header>
  );
}
