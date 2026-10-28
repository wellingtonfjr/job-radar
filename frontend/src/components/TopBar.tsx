import type { FormEvent } from 'react';
import { useRoleMarks } from '../hooks/useRoleMarks';
import { LOCALES, setLocale, useI18n } from '../i18n';
import { SAVED_PATH, useLocation } from '../lib/router';
import { savedRoles } from '../lib/savedRoles';
import { Icon } from './Icon';
import { Link } from './Link';

interface TopBarProps {
  lastUpdatedAt: string | null | undefined;
  search: string;
  onSearchChange: (value: string) => void;
  onSearchSubmit: () => void;
}

export function TopBar({ lastUpdatedAt, search, onSearchChange, onSearchSubmit }: TopBarProps) {
  const { locale, t, fmt } = useI18n();
  const savedCount = savedRoles(useRoleMarks()).length;
  const onSavedPage = useLocation().pathname.startsWith(SAVED_PATH);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSearchSubmit();
  };
  return (
    <header className="topbar">
      <div className="topbar__inner">
        <Link href="/" className="brand" aria-label={t.topBar.home}>
          <img src="/radar.svg" alt="" width={28} height={28} />
          <span className="brand__name">job-radar</span>
        </Link>
        <form className="search" role="search" onSubmit={submit}>
          <Icon name="search" />
          <input
            type="search"
            placeholder={t.topBar.searchPlaceholder}
            aria-label={t.topBar.searchLabel}
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
          />
          <kbd className="search__hint" aria-hidden="true">
            /
          </kbd>
        </form>
        <div className="topbar__end">
          <div className="lang-switch" role="group" aria-label={t.topBar.language}>
            {LOCALES.map((l) => (
              <button
                key={l.id}
                type="button"
                className="lang-switch__option"
                lang={l.id}
                title={l.name}
                aria-pressed={l.id === locale}
                onClick={() => setLocale(l.id)}
              >
                {l.short}
              </button>
            ))}
          </div>
          <Link
            href={SAVED_PATH}
            className="saved-link"
            aria-label={t.topBar.savedLabel(savedCount)}
            aria-current={onSavedPage ? 'page' : undefined}
          >
            <Icon name={savedCount > 0 ? 'star' : 'star-outline'} size={16} />
            <span className="saved-link__label">{t.topBar.saved}</span>
            {savedCount > 0 && <span className="count-dot">{fmt.count(savedCount)}</span>}
          </Link>
          {lastUpdatedAt && (
            <a className="live" href="#sources" title={t.topBar.liveTitle}>
              <span className="live__dot" aria-hidden="true" />
              <span className="live__label">{t.topBar.live}</span>
              <span className="live__time">· {fmt.relative(lastUpdatedAt)}</span>
            </a>
          )}
        </div>
      </div>
    </header>
  );
}
