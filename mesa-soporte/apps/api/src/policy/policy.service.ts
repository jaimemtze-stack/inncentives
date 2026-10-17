import { Injectable } from '@nestjs/common';
import { Permission, roleHasPermission, type Role } from '@mesa/shared';
import type { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../common/request-context';

/**
 * Object-level authorization. Every query that lists or loads records for a
 * user goes through one of these filters, so search, exports and future
 * endpoints share the same rules.
 */
@Injectable()
export class PolicyService {
  /** Users the actor may see. */
  userScope(actor: AuthenticatedUser): Prisma.UserWhereInput {
    switch (actor.role) {
      case 'ADMIN':
        return {};
      case 'AGENT':
        return { role: 'CUSTOMER' };
      default:
        return { id: actor.id };
    }
  }

  /** Organizations the actor may see. */
  organizationScope(actor: AuthenticatedUser): Prisma.OrganizationWhereInput {
    switch (actor.role) {
      case 'ADMIN':
        return {};
      case 'AGENT':
        return { isInternal: false };
      default:
        return { id: actor.organizationId };
    }
  }

  /** Whether the actor may invite someone with `role` into an organization. */
  canInvite(actor: AuthenticatedUser, role: Role, organization: { isInternal: boolean }): boolean {
    if (role === 'CUSTOMER') {
      return (
        roleHasPermission(actor.role, Permission.UsersInviteCustomer) && !organization.isInternal
      );
    }
    return roleHasPermission(actor.role, Permission.UsersInviteStaff) && organization.isInternal;
  }
}
