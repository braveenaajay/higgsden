import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { api } from '../api';
import { AppFrame, FetchProgress, Screen } from '../components/shell';
import { Button, Card, Field, TextInput } from '../components/ui';
import { ThemeToggle } from '../theme';

export function SignIn() {
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const submit = useMutation({
    mutationFn: async () => {
      if (mode === 'sign-up') {
        await api.signUp({ name: name.trim(), email: email.trim(), password });
      } else {
        await api.signIn({ email: email.trim(), password });
      }
    },
    onSuccess: async () => {
      queryClient.clear();
      await navigate({ to: '/' });
    },
  });

  return (
    <AppFrame variant="auth">
      <aside className="den-auth-brand">
        <p className="text-[13px] font-semibold uppercase tracking-[0.18em] text-[var(--color-nav-muted)]">HiggsDEN</p>
        <p className="font-display text-5xl leading-tight">The den for agency delivery.</p>
        <p className="max-w-sm text-[16px] leading-7 text-[var(--color-nav-text)]">
          One workspace for members, discovery, hosting, and merchant desk — without mixing Agency knowledge.
        </p>
      </aside>
      <FetchProgress />
      <Screen>
        <div className="mb-4 flex justify-end">
          <ThemeToggle />
        </div>
        <p className="text-[13px] font-semibold uppercase tracking-[0.14em] text-ember-dark">HiggsDEN</p>
        <h1 className="mt-2 font-display text-[32px] leading-tight lg:text-[40px]">{mode === 'sign-in' ? 'Sign in' : 'Create an account'}</h1>
        <p className="mt-2 max-w-xl text-[15px] leading-6 text-ink-soft">
          {mode === 'sign-in' ? 'Use the email and password for your HiggsDEN account.' : 'Start an Agency after you create your account. Password must be at least 10 characters.'}
        </p>
        <Card className="mt-6 space-y-4 p-4 lg:max-w-md lg:p-5">
          {mode === 'sign-up' ? (
            <Field label="Name" htmlFor="name">
              <TextInput id="name" name="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
          ) : null}
          <Field label="Email" htmlFor="email">
            <TextInput id="email" name="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Password" htmlFor="password">
            <TextInput
              id="password"
              name="password"
              type="password"
              autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <Button
            onClick={() => submit.mutate()}
            loading={submit.isPending}
            loadingLabel={mode === 'sign-in' ? 'Signing in' : 'Creating account'}
          >
            {mode === 'sign-in' ? 'Sign in' : 'Create account'}
          </Button>
          {submit.error ? (
            <p className="text-[15px] font-medium text-clay" role="alert">
              {submit.error.message}
            </p>
          ) : null}
        </Card>
        <p className="mt-4 text-[15px]">
          {mode === 'sign-in' ? (
            <button type="button" className="min-h-12 font-semibold text-ember-dark" onClick={() => setMode('sign-up')}>
              Create an account
            </button>
          ) : (
            <button type="button" className="min-h-12 font-semibold text-ember-dark" onClick={() => setMode('sign-in')}>
              Sign in instead
            </button>
          )}
        </p>
      </Screen>
    </AppFrame>
  );
}
