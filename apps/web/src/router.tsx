import { createRootRoute, createRoute, createRouter, Outlet } from '@tanstack/react-router';
import { AgencyLayout } from './pages/AgencyLayout';
import { Billing } from './pages/Billing';
import { DeskPage } from './pages/DeskPage';
import { GitHubPage } from './pages/GitHubPage';
import { Home } from './pages/Home';
import { HostingPage } from './pages/HostingPage';
import { Members } from './pages/Members';
import { OperatorPage } from './pages/OperatorPage';
import { ProjectPage } from './pages/ProjectPage';
import { SignIn } from './pages/SignIn';
import { SupportPage } from './pages/SupportPage';
import { WidgetPage } from './pages/WidgetPage';
import { Workspace } from './pages/Workspace';

const rootRoute = createRootRoute({ component: () => <Outlet /> });

const homeRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: Home });
const signInRoute = createRoute({ getParentRoute: () => rootRoute, path: '/sign-in', component: SignIn });
const opsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/ops', component: OperatorPage });
const widgetRoute = createRoute({ getParentRoute: () => rootRoute, path: '/widget/$widgetKey', component: WidgetPage });
const agencyRoute = createRoute({ getParentRoute: () => rootRoute, path: '/a/$agencyId', component: AgencyLayout });
const workspaceRoute = createRoute({ getParentRoute: () => agencyRoute, path: '/', component: Workspace });
const membersRoute = createRoute({ getParentRoute: () => agencyRoute, path: 'members', component: Members });
const billingRoute = createRoute({ getParentRoute: () => agencyRoute, path: 'billing', component: Billing });
const githubRoute = createRoute({ getParentRoute: () => agencyRoute, path: 'github', component: GitHubPage });
const hostingRoute = createRoute({ getParentRoute: () => agencyRoute, path: 'hosting', component: HostingPage });
const deskRoute = createRoute({ getParentRoute: () => agencyRoute, path: 'desk', component: DeskPage });
const supportRoute = createRoute({ getParentRoute: () => agencyRoute, path: 'support', component: SupportPage });
const projectRoute = createRoute({ getParentRoute: () => agencyRoute, path: 'p/$projectId', component: ProjectPage });

const routeTree = rootRoute.addChildren([
  homeRoute,
  signInRoute,
  opsRoute,
  widgetRoute,
  agencyRoute.addChildren([workspaceRoute, membersRoute, billingRoute, githubRoute, hostingRoute, deskRoute, supportRoute, projectRoute]),
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
