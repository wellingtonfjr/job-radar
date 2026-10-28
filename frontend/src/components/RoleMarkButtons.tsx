import { useRoleMarks } from '../hooks/useRoleMarks';
import { useI18n } from '../i18n';
import { toggleApplied, toggleSaved, type RoleSnapshot } from '../lib/savedRoles';
import { Icon } from './Icon';

interface RoleMarkButtonsProps {
  role: RoleSnapshot;
  /** `compact`: icon-only, for list rows. `full`: labelled, for the role detail. */
  variant: 'compact' | 'full';
}

/** Save (star) and "Applied" toggles for one role. */
export function RoleMarkButtons({ role, variant }: RoleMarkButtonsProps) {
  const { t } = useI18n();
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
        aria-label={compact ? t.marks.saveRole(role.title) : undefined}
        title={compact ? (saved ? t.marks.saved : t.marks.save) : undefined}
        onClick={() => toggleSaved(role)}
      >
        <Icon name={saved ? 'star' : 'star-outline'} size={compact ? 18 : 16} />
        {!compact && t.marks.save}
      </button>
      <button
        type="button"
        className={compact ? 'mark-button' : 'button button--secondary mark-toggle'}
        aria-pressed={applied}
        aria-label={compact ? t.marks.markRoleApplied(role.title) : undefined}
        title={compact ? (applied ? t.marks.applied : t.marks.markApplied) : undefined}
        onClick={() => toggleApplied(role)}
      >
        <Icon name="check" size={compact ? 18 : 16} />
        {!compact && t.marks.applied}
      </button>
    </div>
  );
}
