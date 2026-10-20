import { ROLE_LABELS } from '@higgsden/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, Outlet, useNavigate, useParams, useRouterState } from '@tanstack/react-router';
import { api, ApiError } from '../api';
import { AppFrame, FetchProgress, Screen } from '../components/shell';
import { Badge, Button, Message, SkeletonScreen } from '../components/ui';
import { ThemeToggle } from '../theme';

const NAV: {
  to: '/a/$agencyId' | '/a/$agencyId/members' | '/a/$agencyId/billing' | '/a/$agencyId/github' | '/a/$agencyId/hosting' | '/a/$agencyId/desk' | '/a/$agencyId/support';
  label: string;
  icon: string;
}[] = [
  { to: '/a/$agencyId', label: 'Workspace', icon: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z' },
  { to: '/a/$agencyId/desk', label: 'Desk', icon: 'M4 5h16v11H8l-4 4z' },
  { to: '/a/$agencyId/members', label: 'Members', icon: 'M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4zm-7 8a7 7 0 0 1 14 0' },
  { to: '/a/$agencyId/github', label: 'GitHub', icon: 'M8 4h8v2H8zm-3 4h14v10H5zm3 3h2v4H8zm6 0h2v4h-2z' },
  { to: '/a/$agencyId/billing', label: 'Billing', icon: 'M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zm0 3h18' },
  { to: '/a/$agencyId/hosting', label: 'Hosting', icon: 'M4 16h16v3H4zm2-9h12v6H6zM9 4h6v2H9z' },
  { to: '/a/$agencyId/support', label: 'Support', icon: 'M12 3a9 9 0 1 0 9 9h-2a7 7 0 1 1-7-7zm1 4v5h4' },
];

export function AgencyLayout() {
  const { agencyId } = useParams({ from: '/a/$agencyId' });
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const signOut = useMutation({
    mutationFn: api.signOut,
    onSuccess: async () => {
      queryClient.clear();
      await navigate({ to: '/sign-in' });
    },
  });

  if (me.error instanceof ApiError && me.error.status === 401) return <Navigate to="/sign-in" />;
  if (me.isPending) {
    return (
      <AppFrame>
        <SkeletonScreen label="Loading your workspace" />
      </AppFrame>
    );
  }
  if (me.error) {
    return (
      <AppFrame>
        <Message title="Could not load your account" />
      </AppFrame>
    );
  }

  const current = me.data.memberships.find((m) => m.agencyId === agencyId);

  return (
    <AppFrame withNav={Boolean(current)}>
      <FetchProgress />
      <header className="den-topbar">
        <Link to="/" className="den-mobile-only flex min-h-12 min-w-12 flex-col justify-center px-1 font-display text-lg leading-none">
          HiggsDEN
        </Link>
        <Badge tone="amber">Dummy data</Badge>
        <div className="ml-auto flex items-center gap-3">
          {current ? (
            <div className="den-desktop-cluster">
              {me.data.memberships.length > 1 ? (
                <>
                  <label htmlFor="agency-switch-desktop" className="sr-only">
                    Agency
                  </label>
                  <select
                    id="agency-switch-desktop"
                    aria-label="Agency"
                    value={agencyId}
                    onChange={(e) => navigate({ to: '/a/$agencyId', params: { agencyId: e.target.value } })}
                    className="min-h-12 min-w-52 rounded-2xl border border-line bg-sheet px-3 text-[16px]"
                  >
                    {me.data.memberships.map((m) => (
                      <option key={m.agencyId} value={m.agencyId}>
                        {m.agencyName}
                      </option>
                    ))}
                  </select>
                </>
              ) : (
                <p className="text-[15px] font-semibold">{current.agencyName}</p>
              )}
              <Badge tone="violet">{ROLE_LABELS[current.role]}</Badge>
              {me.data.user.isOperator ? (
                <Link to="/ops" className="inline-flex min-h-12 items-center px-2 text-[15px] font-semibold text-ember-dark underline decoration-from-font underline-offset-4">
                  Operator
                </Link>
              ) : null}
            </div>
          ) : null}
          <ThemeToggle />
          <Button tone="ghost" onClick={() => signOut.mutate()} loading={signOut.isPending} loadingLabel="Signing out">
            Sign out
          </Button>
        </div>
      </header>
      {current ? (
        <div className="den-agencybar den-mobile-only">
          {me.data.memberships.length > 1 ? (
            <label htmlFor="agency-switch" className="sr-only">
              Agency
            </label>
          ) : null}
          {me.data.memberships.length > 1 ? (
            <select
              id="agency-switch"
              aria-label="Agency"
              value={agencyId}
              onChange={(e) => navigate({ to: '/a/$agencyId', params: { agencyId: e.target.value } })}
              className="min-h-12 min-w-0 flex-1 rounded-2xl border border-line bg-sheet px-3 text-[16px]"
            >
              {me.data.memberships.map((m) => (
                <option key={m.agencyId} value={m.agencyId}>
                  {m.agencyName}
                </option>
              ))}
            </select>
          ) : (
            <p className="min-w-0 flex-1 truncate text-[15px] font-semibold">{current.agencyName}</p>
          )}
          <Badge tone="violet">{ROLE_LABELS[current.role]}</Badge>
          {me.data.user.isOperator ? (
            <Link to="/ops" className="inline-flex min-h-12 items-center px-2 text-[15px] font-semibold text-ember-dark underline decoration-from-font underline-offset-4">
              Operator
            </Link>
          ) : null}
        </div>
      ) : null}
      <Screen>{current ? <Outlet /> : <Message title="You are not a member of this Agency." />}</Screen>
      {current ? (
        <nav className="den-nav" aria-label="Agency">
          <Link to="/" className="den-nav-brand">
            HiggsDEN
          </Link>
          <p className="den-nav-kicker">{current.agencyName}</p>
          {NAV.map((item) => {
            const href = item.to.replace('$agencyId', agencyId);
            const active = item.to === '/a/$agencyId' ? pathname === `/a/${agencyId}` || pathname === `/a/${agencyId}/` : pathname.startsWith(href);
            return (
              <Link
                key={item.label}
                to={item.to}
                params={{ agencyId }}
                activeOptions={{ exact: item.to === '/a/$agencyId' }}
                aria-current={active ? 'page' : undefined}
                className={`den-nav-item ${active ? 'is-active' : ''}`}
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill="currentColor" aria-hidden="true">
                  <path d={item.icon} />
                </svg>
                {item.label}
              </Link>
            );
          })}
        </nav>
      ) : null}
    </AppFrame>
  );
}
