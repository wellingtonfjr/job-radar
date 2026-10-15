import { useState } from 'react';

interface CompanyLogoProps {
  name: string;
  src: string | null;
  size?: 'md' | 'lg';
}

/** Source-provided logo, falling back to the company's initial. */
export function CompanyLogo({ name, src, size = 'md' }: CompanyLogoProps) {
  const [failed, setFailed] = useState(false);
  const initial = name.trim().charAt(0).toUpperCase() || '?';
  return (
    <span className={`company-logo company-logo--${size}`} aria-hidden="true">
      {src && !failed ? <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} /> : initial}
    </span>
  );
}
