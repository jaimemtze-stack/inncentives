import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { Layout } from './components/Layout';
import { RequireAuth } from './components/RequireAuth';
import { AccountPage } from './pages/Account';
import { AdminPage } from './pages/Admin';
import { AuditPage } from './pages/Audit';
import { ForgotPage } from './pages/Forgot';
import { ConfigAdminPage } from './pages/ConfigAdmin';
import { PhonePage } from './pages/Phone';
import { ReportsPage } from './pages/Reports';
import { ReportPage } from './pages/Report';
import { ChatPage } from './pages/Chat';
import { KbAnswerPage, KbNewPage, KbPage } from './pages/Kb';
import { TimeSummaryPage } from './pages/TimeSummary';
import { TicketNewPage } from './pages/TicketNew';
import { TicketsPage } from './pages/Tickets';
import { TicketZoomPage } from './pages/TicketZoom';
import { InvitationPage } from './pages/Invitation';
import { LoginPage } from './pages/Login';
import { MfaEnrollPage } from './pages/MfaEnroll';
import { MfaVerifyPage } from './pages/MfaVerify';
import { ResetPage } from './pages/Reset';

const root = createRootRoute({ component: Layout });
const protectedPage = (Page: () => JSX.Element | null) => () => (
  <RequireAuth>
    <Page />
  </RequireAuth>
);

const routes = [
  createRoute({ getParentRoute: () => root, path: '/', component: protectedPage(TicketsPage) }),
  createRoute({
    getParentRoute: () => root,
    path: '/tickets/nuevo',
    component: protectedPage(TicketNewPage),
  }),
  createRoute({
    getParentRoute: () => root,
    path: '/tickets/$id',
    component: protectedPage(TicketZoomPage),
  }),
  createRoute({
    getParentRoute: () => root,
    path: '/telefono',
    component: protectedPage(PhonePage),
  }),
  createRoute({ getParentRoute: () => root, path: '/kb', component: protectedPage(KbPage) }),
  createRoute({
    getParentRoute: () => root,
    path: '/reportar',
    component: protectedPage(ReportPage),
  }),
  createRoute({ getParentRoute: () => root, path: '/chat', component: protectedPage(ChatPage) }),
  createRoute({
    getParentRoute: () => root,
    path: '/reportes',
    component: protectedPage(ReportsPage),
  }),
  createRoute({
    getParentRoute: () => root,
    path: '/kb/nueva',
    component: protectedPage(KbNewPage),
  }),
  createRoute({
    getParentRoute: () => root,
    path: '/kb/$id',
    component: protectedPage(KbAnswerPage),
  }),
  createRoute({
    getParentRoute: () => root,
    path: '/tiempo',
    component: protectedPage(TimeSummaryPage),
  }),
  createRoute({
    getParentRoute: () => root,
    path: '/configuracion',
    component: protectedPage(ConfigAdminPage),
  }),
  createRoute({ getParentRoute: () => root, path: '/entrar', component: LoginPage }),
  createRoute({ getParentRoute: () => root, path: '/verificar', component: MfaVerifyPage }),
  createRoute({ getParentRoute: () => root, path: '/configurar-mfa', component: MfaEnrollPage }),
  createRoute({ getParentRoute: () => root, path: '/olvide', component: ForgotPage }),
  createRoute({ getParentRoute: () => root, path: '/restablecer', component: ResetPage }),
  createRoute({ getParentRoute: () => root, path: '/invitacion', component: InvitationPage }),
  createRoute({
    getParentRoute: () => root,
    path: '/cuenta',
    component: protectedPage(AccountPage),
  }),
  createRoute({ getParentRoute: () => root, path: '/admin', component: protectedPage(AdminPage) }),
  createRoute({
    getParentRoute: () => root,
    path: '/admin/bitacora',
    component: protectedPage(AuditPage),
  }),
];

export const router = createRouter({ routeTree: root.addChildren(routes) });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
