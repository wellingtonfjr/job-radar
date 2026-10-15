import type { AnchorHTMLAttributes, MouseEvent } from 'react';
import { navigate } from '../lib/router';

interface LinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
  /** Runs before client-side navigation (e.g. to remember scroll position). */
  onNavigate?: () => void;
}

/** In-app link: client-side navigation, but modifier-clicks still open new tabs. */
export function Link({ href, onNavigate, onClick, ...rest }: LinkProps) {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onNavigate?.();
    navigate(href);
  };
  return <a href={href} onClick={handleClick} {...rest} />;
}
