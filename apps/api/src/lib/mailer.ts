import type { FastifyBaseLogger } from "fastify";

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

/**
 * Mailer de desarrollo: escribe el correo en el log en lugar de enviarlo.
 * En producción se reemplaza por un proveedor real (pendiente de elegir).
 */
export class LogMailer implements Mailer {
  constructor(private log: FastifyBaseLogger) {}
  async send(mail: Mail) {
    this.log.info({ mail }, "mail (dev): no enviado, solo registrado");
  }
}

/** Mailer para tests: guarda los correos en memoria. */
export class MemoryMailer implements Mailer {
  sent: Mail[] = [];
  async send(mail: Mail) {
    this.sent.push(mail);
  }
}

/** Envío real mediante la API HTTP de Brevo (sin dependencias). */
export class BrevoMailer implements Mailer {
  constructor(
    private apiKey: string,
    private from: { email: string; name: string },
    private log: FastifyBaseLogger,
  ) {}
  async send(mail: Mail) {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": this.apiKey, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ sender: this.from, to: [{ email: mail.to }], subject: mail.subject, textContent: mail.text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      this.log.error({ status: res.status, body: await res.text().catch(() => "") }, "mail: Brevo rechazó el envío");
      throw new Error("mail_send_failed");
    }
  }
}
