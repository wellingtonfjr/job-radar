import { formatRelative } from '../lib/format';
import { Link } from './Link';

interface SiteHeaderProps {
  lastUpdatedAt: string | null | undefined;
}

export function SiteHeader({ lastUpdatedAt }: SiteHeaderProps) {
  return (
    <header className="site-header">
      <div className="container site-header__inner">
        <Link href="/" className="brand" aria-label="job-radar home">
          <img src="/radar.svg" alt="" width={32} height={32} />
          <span>job-radar</span>
        </Link>
        {lastUpdatedAt && (
          <a className="freshness" href="#sources">
            <span className="freshness__dot" aria-hidden="true" />
            Updated {formatRelative(lastUpdatedAt)}
          </a>
        )}
      </div>
    </header>
  );
}
