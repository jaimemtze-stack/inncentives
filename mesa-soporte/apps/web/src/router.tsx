import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { Layout } from './components/Layout';
import { RequireAuth } from './components/RequireAuth';
import { AccountPage } from './pages/Account';
import { AdminPage } from './pages/Admin';
import { AuditPage } from './pages/Audit';
import { ForgotPage } from './pages/Forgot';
import { HomePage } from './pages/Home';
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
  createRoute({ getParentRoute: () => root, path: '/', component: protectedPage(HomePage) }),
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
