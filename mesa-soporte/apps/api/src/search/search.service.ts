import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../common/request-context';
import { KbService } from '../kb/kb.service';
import { OverviewsService } from '../overviews/overviews.service';
import { PolicyService } from '../policy/policy.service';
import { PrismaService } from '../prisma/prisma.service';
import { TicketAccessService } from '../tickets/access.service';

/**
 * Global search. Each section reuses the policy of its resource, so a result
 * is only returned when the user could open it.
 */
@Injectable()
export class SearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly overviews: OverviewsService,
    private readonly kb: KbService,
    private readonly policy: PolicyService,
    private readonly access: TicketAccessService,
  ) {}

  async global(actor: AuthenticatedUser, q: string, locale?: string) {
    const term = q
      .replace(/[a-zñ]+:("[^"]*"|\S+)/gi, '')
      .replace(/#\d+/g, '')
      .trim();
    const staff = this.access.isStaff(actor);
    const [tickets, kb, users, organizations] = await Promise.all([
      this.overviews.search(actor, q, 20),
      term.length >= 2 ? this.kb.search(actor, term, locale, 5) : [],
      staff && term.length >= 2
        ? this.prisma.user.findMany({
            where: {
              AND: [
                this.policy.userScope(actor),
                { status: 'ACTIVE' },
                {
                  OR: [
                    { name: { contains: term, mode: 'insensitive' } },
                    { email: { contains: term.toLowerCase() } },
                  ],
                },
              ],
            },
            select: {
              id: true,
              name: true,
              email: true,
              role: true,
              organization: { select: { name: true } },
            },
            take: 10,
          })
        : [],
      staff && term.length >= 2
        ? this.prisma.organization.findMany({
            where: {
              AND: [
                this.policy.organizationScope(actor),
                { name: { contains: term, mode: 'insensitive' } },
              ],
            },
            select: { id: true, name: true, domains: true },
            take: 10,
          })
        : [],
    ]);
    return { tickets: tickets.items, kb, users, organizations };
  }
}
