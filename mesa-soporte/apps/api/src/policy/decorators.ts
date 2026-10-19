import { SetMetadata, applyDecorators } from '@nestjs/common';
import type { AuthState, HostArea, Permission } from '@mesa/shared';

export const PUBLIC_KEY = 'authz:public';
export const PERMISSIONS_KEY = 'authz:permissions';
export const ANY_PERMISSIONS_KEY = 'authz:any-permissions';
export const STATES_KEY = 'authz:states';
export const AREA_KEY = 'authz:area';
export const REAUTH_KEY = 'authz:reauth';

/** No session required. Public routes must still pick their host area(s). */
export const Public = (area: HostArea | 'any' = 'any') =>
  applyDecorators(SetMetadata(PUBLIC_KEY, true), SetMetadata(AREA_KEY, area));

/** Requires an authenticated session holding every listed permission. */
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

/** Requires an authenticated session holding at least one listed permission. */
export const RequireAnyPermission = (...permissions: Permission[]) =>
  SetMetadata(ANY_PERMISSIONS_KEY, permissions);

/** Restricts a route (or controller) to one host area. */
export const Area = (area: HostArea) => SetMetadata(AREA_KEY, area);

/** Session states allowed besides the default ('authenticated'). */
export const AllowStates = (...states: AuthState[]) => SetMetadata(STATES_KEY, states);

/** Requires a recent password re-entry (ASVS 3.7.1). */
export const RequireReauth = () => SetMetadata(REAUTH_KEY, true);
