import { useState } from 'react';

interface CompanyLogoProps {
  name: string;
  src: string | null;
  size?: 'md' | 'lg';
}

// Deterministic tint per company so initials-only logos are distinguishable.
const TINTS = ['#3d5afe', '#0f766e', '#b45309', '#be185d', '#6d28d9', '#0369a1', '#4d7c0f', '#c2410c'];

function tintFor(name: string): string {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return TINTS[Math.abs(hash) % TINTS.length] as string;
}

/** Source-provided logo, falling back to a tinted initial. */
export function CompanyLogo({ name, src, size = 'md' }: CompanyLogoProps) {
  const [failed, setFailed] = useState(false);
  const initial = name.trim().charAt(0).toUpperCase() || '?';
  const showImage = src && !failed;
  return (
    <span
      className={`company-logo company-logo--${size}${showImage ? '' : ' company-logo--initial'}`}
      style={showImage ? undefined : { backgroundColor: tintFor(name) }}
      aria-hidden="true"
    >
      {showImage ? <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} /> : initial}
    </span>
  );
}
