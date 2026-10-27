import { useRoleMarks } from '../hooks/useRoleMarks';
import { toggleApplied, toggleSaved, type RoleSnapshot } from '../lib/savedRoles';
import { Icon } from './Icon';

interface RoleMarkButtonsProps {
  role: RoleSnapshot;
  /** `compact`: icon-only, for list rows. `full`: labelled, for the role detail. */
  variant: 'compact' | 'full';
}

/** Save (star) and "Applied" toggles for one role. */
export function RoleMarkButtons({ role, variant }: RoleMarkButtonsProps) {
  const mark = useRoleMarks()[role.id];
  const saved = Boolean(mark?.savedAt);
  const applied = Boolean(mark?.appliedAt);
  const compact = variant === 'compact';

  return (
    <div className={`role-marks role-marks--${variant}`}>
      <button
        type="button"
        className={compact ? 'mark-button' : 'button button--secondary mark-toggle'}
        aria-pressed={saved}
        aria-label={compact ? `Save ${role.title}` : undefined}
        title={compact ? (saved ? 'Saved' : 'Save') : undefined}
        onClick={() => toggleSaved(role)}
      >
        <Icon name={saved ? 'star' : 'star-outline'} size={compact ? 18 : 16} />
        {!compact && 'Save'}
      </button>
      <button
        type="button"
        className={compact ? 'mark-button' : 'button button--secondary mark-toggle'}
        aria-pressed={applied}
        aria-label={compact ? `Mark ${role.title} as applied` : undefined}
        title={compact ? (applied ? 'Applied' : 'Mark as applied') : undefined}
        onClick={() => toggleApplied(role)}
      >
        <Icon name="check" size={compact ? 18 : 16} />
        {!compact && 'Applied'}
      </button>
    </div>
  );
}
