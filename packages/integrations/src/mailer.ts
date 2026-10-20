import nodemailer from 'nodemailer';

export interface Mailer {
  send(input: { to: string; subject: string; text: string }): Promise<void>;
}

/** SMTP works for both the local mail catcher and Amazon SES SMTP credentials. */
export class SmtpMailer implements Mailer {
  private readonly transport;

  constructor(
    options: { host: string; port: number; user?: string; password?: string },
    private readonly from: string,
  ) {
    this.transport = nodemailer.createTransport({
      host: options.host,
      port: options.port,
      secure: options.port === 465,
      auth: options.user ? { user: options.user, pass: options.password } : undefined,
    });
  }

  async send(input: { to: string; subject: string; text: string }) {
    await this.transport.sendMail({ from: this.from, ...input });
  }
}
