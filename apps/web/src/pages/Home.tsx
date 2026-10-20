import { useQuery } from '@tanstack/react-query';
import { Navigate } from '@tanstack/react-router';
import { api, ApiError } from '../api';
import { AppFrame } from '../components/shell';
import { Message, SkeletonScreen } from '../components/ui';

export function Home() {
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });

  if (me.error instanceof ApiError && me.error.status === 401) return <Navigate to="/sign-in" />;
  if (me.isPending) {
    return (
      <AppFrame>
        <SkeletonScreen label="Opening your workspace" />
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

  if (me.data.user.isOperator && me.data.memberships.length === 0) return <Navigate to="/ops" />;
  const first = me.data.memberships[0];
  if (!first) {
    return (
      <AppFrame>
        <Message title="You are not a member of any Agency yet" />
      </AppFrame>
    );
  }
  return <Navigate to="/a/$agencyId" params={{ agencyId: first.agencyId }} />;
}
