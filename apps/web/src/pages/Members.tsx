import { ROLE_LABELS, type Role } from '@higgsden/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { useState } from 'react';
import { api } from '../api';
import { PageTitle } from '../components/shell';
import { Badge, Button, Card, Field, Select, SkeletonScreen, StatusBadge, TextInput } from '../components/ui';

interface MembersPayload {
  seats: { used: number; cap: number };
  clients: { id: string; name: string }[];
  members: { id: string; name: string; email: string; role: Role; status: string; clientIds: string[] }[];
  invitations: { id: string; email: string; role: Role; expiresAt: string }[];
}

export function Members() {
  const { agencyId } = useParams({ from: '/a/$agencyId/members' });
  const qc = useQueryClient();
  const data = useQuery({ queryKey: ['members', agencyId], queryFn: () => api.get<MembersPayload>(`/agencies/${agencyId}/members`) });
  const [email, setEmail] = useState('invitee@example.test');
  const [role, setRole] = useState<Role>('engineer');
  const invite = useMutation({
    mutationFn: () => api.post<{ id: string; link?: string }>(`/agencies/${agencyId}/invitations`, { email, role, clientIds: [] }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['members', agencyId] }),
  });

  if (data.isPending) return <SkeletonScreen label="Loading members" />;
  if (!data.data) return <SkeletonScreen label="Loading members" />;
  const d = data.data;
  return (
    <>
      <PageTitle hint={`Seats ${d.seats.used} of ${d.seats.cap}. Pending invites count toward the cap.`}>Members</PageTitle>
      <Card className="space-y-3 p-4 lg:max-w-3xl lg:p-5">
        <h2 className="font-display text-lg">Invite</h2>
        <form
          className="grid gap-3 lg:grid-cols-[1fr_16rem_auto] lg:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            invite.mutate();
          }}
        >
          <Field label="Email" htmlFor="invite-email">
            <TextInput
              id="invite-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field label="Role" htmlFor="invite-role">
            <Select id="invite-role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </Select>
          </Field>
          <Button type="submit" loading={invite.isPending} loadingLabel="Sending invite">
            Send invite
          </Button>
        </form>
        {invite.data?.link ? <p className="text-[13px] text-ink-soft">Dummy invite link: {invite.data.link}</p> : null}
        {invite.error ? (
          <p className="text-[15px] font-medium text-clay" role="alert">
            {invite.error.message}
          </p>
        ) : null}
      </Card>
      <ul className="mt-4 grid gap-2 lg:grid-cols-2">
        {d.members.map((m) => (
          <li key={m.id} className="flex min-h-14 items-center justify-between gap-3 rounded-2xl bg-sheet px-4 py-3 ring-1 ring-line">
            <span>
              <span className="block font-semibold">{m.name}</span>
              <span className="text-[14px] text-ink-soft">{m.email}</span>
            </span>
            <span className="flex flex-col items-end gap-1">
              <Badge tone="violet">{ROLE_LABELS[m.role]}</Badge>
              <StatusBadge status={m.status} />
            </span>
          </li>
        ))}
      </ul>
      {d.invitations.length ? (
        <div className="mt-5">
          <h2 className="font-display text-lg">Pending invites</h2>
          {d.invitations.map((i) => (
            <p key={i.id} className="mt-2 min-h-12 text-[15px] text-ink-soft">
              {i.email} · {ROLE_LABELS[i.role]}
            </p>
          ))}
        </div>
      ) : null}
    </>
  );
}
