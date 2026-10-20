import { useMutation } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { useState } from 'react';
import { api } from '../api';
import { AppFrame, FetchProgress, Screen } from '../components/shell';
import { Button, Card, Field, TextArea, TextInput } from '../components/ui';

export function WidgetPage() {
  const { widgetKey } = useParams({ from: '/widget/$widgetKey' });
  const [name, setName] = useState('Maya Merchant');
  const [email, setEmail] = useState('maya@store.test');
  const [subject, setSubject] = useState('Checkout gift message is too long');
  const [body, setBody] = useState('Customers cannot save a 201-character gift message.');
  const open = useMutation({
    mutationFn: () =>
      api.post<{ conversationId: string }>(`/widget/${widgetKey}/conversations`, {
        merchantName: name,
        merchantEmail: email,
        subject,
        body,
        consent: true,
      }),
  });
  return (
    <AppFrame variant="narrow">
      <FetchProgress />
      <Screen>
        <p className="text-[13px] font-semibold uppercase tracking-[0.14em] text-ember-dark">Merchant widget (dummy)</p>
        <h1 className="mt-2 font-display text-[28px] leading-tight">Contact the delivery team</h1>
        <Card className="mt-5 space-y-3 p-4">
          <Field label="Name" htmlFor="widget-name">
            <TextInput id="widget-name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Email" htmlFor="widget-email">
            <TextInput id="widget-email" type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Subject" htmlFor="widget-subject">
            <TextInput id="widget-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
          </Field>
          <Field label="Message" htmlFor="widget-message">
            <TextArea id="widget-message" rows={4} value={body} onChange={(e) => setBody(e.target.value)} />
          </Field>
          <Button onClick={() => open.mutate()} loading={open.isPending} loadingLabel="Sending">
            Send
          </Button>
          {open.data ? <p className="text-[15px] text-moss">Opened conversation {open.data.conversationId}</p> : null}
          {open.error ? (
            <p className="text-[15px] font-medium text-clay" role="alert">
              {open.error.message}
            </p>
          ) : null}
        </Card>
      </Screen>
    </AppFrame>
  );
}
