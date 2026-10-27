import { useSyncExternalStore } from 'react';
import { getRoleMarks, subscribeRoleMarks, type RoleMarks } from '../lib/savedRoles';

/** Saved/applied marks, shared by every component and kept in sync across tabs. */
export function useRoleMarks(): RoleMarks {
  return useSyncExternalStore(subscribeRoleMarks, getRoleMarks);
}
