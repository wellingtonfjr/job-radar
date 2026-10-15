import type { FormEvent } from 'react';
import { formatRelative } from '../lib/format';
import { Icon } from './Icon';
import { Link } from './Link';

interface TopBarProps {
  lastUpdatedAt: string | null | undefined;
  search: string;
  onSearchChange: (value: string) => void;
  onSearchSubmit: () => void;
}

export function TopBar({ lastUpdatedAt, search, onSearchChange, onSearchSubmit }: TopBarProps) {
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSearchSubmit();
  };
  return (
    <header className="topbar">
      <div className="topbar__inner">
        <Link href="/" className="brand" aria-label="job-radar home">
          <img src="/radar.svg" alt="" width={28} height={28} />
          <span className="brand__name">job-radar</span>
        </Link>
        <form className="search" role="search" onSubmit={submit}>
          <Icon name="search" />
          <input
            type="search"
            placeholder="Role, company or stack — e.g. “react senior”"
            aria-label="Search jobs"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
          />
          <kbd className="search__hint" aria-hidden="true">
            /
          </kbd>
        </form>
        {lastUpdatedAt && (
          <a className="live" href="#sources" title="When the sources were last checked">
            <span className="live__dot" aria-hidden="true" />
            <span className="live__label">Live</span>
            <span className="live__time">· {formatRelative(lastUpdatedAt)}</span>
          </a>
        )}
      </div>
    </header>
  );
}
