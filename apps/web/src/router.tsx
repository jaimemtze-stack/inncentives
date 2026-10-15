import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import {
  AcceptInvitationPage,
  ForgotPasswordPage,
  LoginPage,
  MfaPage,
  MfaSetupPage,
  ResetPasswordPage,
} from './routes/auth-pages';
import { HomePage } from './routes/home';
import { Layout } from './routes/layout';

const root = createRootRoute({ component: Layout });
const routes = [
  createRoute({ getParentRoute: () => root, path: '/', component: HomePage }),
  createRoute({ getParentRoute: () => root, path: '/login', component: LoginPage }),
  createRoute({ getParentRoute: () => root, path: '/mfa', component: MfaPage }),
  createRoute({ getParentRoute: () => root, path: '/mfa-setup', component: MfaSetupPage }),
  createRoute({
    getParentRoute: () => root,
    path: '/forgot-password',
    component: ForgotPasswordPage,
  }),
  createRoute({
    getParentRoute: () => root,
    path: '/reset-password',
    component: ResetPasswordPage,
  }),
  createRoute({
    getParentRoute: () => root,
    path: '/accept-invitation',
    component: AcceptInvitationPage,
  }),
];

export const router = createRouter({ routeTree: root.addChildren(routes) });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
