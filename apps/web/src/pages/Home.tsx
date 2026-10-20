import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { api, ApiError } from '../api';
import { AppFrame, Screen } from '../components/shell';
import { Button, Card, Field, Message, SkeletonScreen, TextInput } from '../components/ui';
import { ThemeToggle } from '../theme';

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
  if (!first) return <Onboarding name={me.data.user.name} />;
  return <Navigate to="/a/$agencyId" params={{ agencyId: first.agencyId }} />;
}

function Onboarding({ name }: { name: string }) {
  const [agencyName, setAgencyName] = useState(name ? `${name}'s Agency` : '');
  const qc = useQueryClient();
  const navigate = useNavigate();
  const create = useMutation({
    mutationFn: () => api.createAgency({ name: agencyName.trim(), kind: 'agency' }),
    onSuccess: async (result) => {
      await qc.invalidateQueries({ queryKey: ['me'] });
      await navigate({ to: '/a/$agencyId', params: { agencyId: result.agencyId } });
    },
  });

  return (
    <AppFrame variant="auth">
      <Screen>
        <div className="mb-4 flex justify-end">
          <ThemeToggle />
        </div>
        <h1 className="font-display text-[32px] leading-tight lg:text-[40px]">Open your Agency</h1>
        <p className="mt-2 max-w-xl text-[15px] leading-6 text-ink-soft">
          This is the billing and isolation boundary. You can add Clients and projects next.
        </p>
        <Card className="mt-6 space-y-4 p-4 lg:max-w-md lg:p-5">
          <Field label="Agency name" htmlFor="agency-name">
            <TextInput id="agency-name" value={agencyName} onChange={(e) => setAgencyName(e.target.value)} autoComplete="organization" />
          </Field>
          <Button onClick={() => create.mutate()} loading={create.isPending} loadingLabel="Opening Agency">
            Create Agency
          </Button>
          {create.error ? (
            <p className="text-[15px] font-medium text-clay" role="alert">
              {create.error.message}
            </p>
          ) : null}
        </Card>
      </Screen>
    </AppFrame>
  );
}
