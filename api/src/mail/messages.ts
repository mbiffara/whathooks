/**
 * Transactional email copy, per locale. Kept as plain string tables (two
 * emails × two languages) — a full i18n library would be overkill here.
 * `localeOf` normalizes whatever is stored on the user to a supported locale.
 */

export type MailLocale = 'en' | 'es';

export function localeOf(value: string | null | undefined): MailLocale {
  return value === 'es' ? 'es' : 'en';
}

export const MAIL_MESSAGES = {
  en: {
    layout: {
      copyLink: 'Or copy this link into your browser:',
      footerTagline: 'whathooks — WhatsApp as a webhook · powered by',
      footerReason:
        'You received this email because of activity on your whathooks account.',
    },
    passwordReset: {
      subject: 'Reset your whathooks password',
      preheader: (validFor: string) =>
        `Your reset link is valid for ${validFor}.`,
      heading: 'Reset your password',
      body: 'Someone requested a password reset for your whathooks account. Click the button below to choose a new password.',
      cta: 'Choose a new password',
      footnote: (validFor: string) =>
        `This link is valid for ${validFor} and can be used once. If you didn't request it, you can ignore this email — your password is unchanged.`,
      validFor: '1 hour',
    },
    welcome: {
      subject: 'Thanks for signing up for Whathooks, a quick note from me.',
      preheader: "What are you planning to build? I'd love to hear it.",
      heading: (name: string | null) => (name ? `Hi ${name}!` : 'Hi there!'),
      body1:
        "I'm Marcelo, the founder of whathooks. Thanks for creating an account, it truly means a lot to me.",
      body2:
        'What are you planning to use whathooks for? A shared support inbox, order notifications, an AI agent answering on WhatsApp?',
      body3:
        "When you hit reply, this email lands directly in my work inbox, so I'll definitely get back to you quickly.",
      body4:
        "If you get stuck connecting your number or firing your first webhook, let me know and I'll gladly help you set it up.",
      signoff: 'Best,',
      signature: 'Marcelo Biffara',
      footnote:
        "You're receiving this because you created a whathooks account. It's a one-time personal note, not a newsletter.",
    },
    agentHandoff: {
      subject: (agent: string) => `${agent} needs a human — handoff`,
      preheader: (contact: string) =>
        `The agent paused itself on the chat with ${contact}.`,
      heading: 'An agent handed off a conversation',
      body1: (agent: string, contact: string) =>
        `${agent} paused itself on the conversation with ${contact} and is waiting for a human to take over.`,
      body2: (reason: string) => `Reason: ${reason}`,
      cta: 'Open the conversation',
      footnote: 'You can turn these notifications off in the agent settings.',
    },
    agentNotify: {
      subject: (agent: string, contact: string) =>
        `${agent} left you a note about ${contact}`,
      preheader: (message: string) => message,
      heading: 'Your agent has something for you',
      body1: (agent: string, contact: string) =>
        `${agent} sent you this note from the conversation with ${contact}:`,
      body2: (message: string) => `“${message}”`,
      cta: 'Open the conversation',
      footnote:
        'The agent sends these when its instructions tell it to use the notify_owner tool.',
    },
    trialEnding: {
      subject: 'Your whathooks trial ends soon',
      preheader: (date: string) =>
        `Your free trial ends on ${date} — cancel anytime before then.`,
      heading: 'Your free trial ends soon',
      body1: (plan: string, date: string) =>
        `Your 7-day free trial of the ${plan} plan ends on ${date}. If you're enjoying whathooks, you don't need to do anything — your subscription starts automatically.`,
      body2:
        "Not the right fit? Cancel before the trial ends and you won't be charged at all.",
      cta: 'Manage your subscription',
      footnote:
        'We send this reminder so the first charge is never a surprise.',
    },
    invitation: {
      subject: (inviter: string, org: string) =>
        `${inviter} invited you to join ${org} on whathooks`,
      preheader: (org: string, expires: string) =>
        `Accept your invitation to ${org} — expires ${expires}.`,
      heading: (org: string) => `Join ${org} on whathooks`,
      body1: (inviter: string, org: string, role: string) =>
        `${inviter} invited you to join ${org} on whathooks as ${role}.`,
      body2:
        'whathooks connects WhatsApp numbers to webhooks, a REST API, and a shared team inbox.',
      cta: 'Accept the invitation',
      footnote: (expires: string) =>
        `This invitation expires on ${expires}. If you weren't expecting it, you can ignore this email.`,
      fallbackInviter: 'A teammate',
    },
  },
  es: {
    layout: {
      copyLink: 'O copia este enlace en tu navegador:',
      footerTagline: 'whathooks — WhatsApp como webhook · creado por',
      footerReason:
        'Recibiste este correo por actividad en tu cuenta de whathooks.',
    },
    passwordReset: {
      subject: 'Restablece tu contraseña de whathooks',
      preheader: (validFor: string) =>
        `Tu enlace de restablecimiento es válido por ${validFor}.`,
      heading: 'Restablece tu contraseña',
      body: 'Alguien solicitó restablecer la contraseña de tu cuenta de whathooks. Haz clic en el botón para elegir una nueva contraseña.',
      cta: 'Elegir una nueva contraseña',
      footnote: (validFor: string) =>
        `Este enlace es válido por ${validFor} y solo puede usarse una vez. Si no lo solicitaste, puedes ignorar este correo — tu contraseña no cambió.`,
      validFor: '1 hora',
    },
    welcome: {
      subject:
        'Gracias por registrarte en Whathooks, te dejo un breve mensaje.',
      preheader: '¿Qué planeas construir? Me encantaría saberlo.',
      heading: (name: string | null) => (name ? `¡Hola ${name}!` : '¡Hola!'),
      body1:
        'Soy Marcelo, el fundador de whathooks. Gracias por crear una cuenta, de verdad significa mucho para mí.',
      body2:
        'Me gustaría que me cuentes ¿para qué planeas usar whathooks? ¿Una bandeja de soporte compartida, notificaciones de pedidos, un agente IA respondiendo por WhatsApp?',
      body3:
        'Al responder, este correo llega directamente a mi email laboral, así que seguro voy a responderte rápidamente.',
      body4:
        'Si te trabas conectando tu número o haciendo que dispare tu primer webhook, avisame y con gusto te ayudo a configurarlo.',
      signoff: 'Saludos,',
      signature: 'Marcelo Biffara',
      footnote:
        'Recibes este correo porque creaste una cuenta en whathooks. Es una nota personal única, no un boletín.',
    },
    agentNotify: {
      subject: (agent: string, contact: string) =>
        `${agent} te dejó un aviso sobre ${contact}`,
      preheader: (message: string) => message,
      heading: 'Tu agente tiene algo para ti',
      body1: (agent: string, contact: string) =>
        `${agent} te envió este aviso desde la conversación con ${contact}:`,
      body2: (message: string) => `“${message}”`,
      cta: 'Abrir la conversación',
      footnote:
        'El agente envía estos avisos cuando sus instrucciones le indican usar la herramienta notify_owner.',
    },
    agentHandoff: {
      subject: (agent: string) => `${agent} necesita un humano — derivación`,
      preheader: (contact: string) =>
        `El agente se pausó en el chat con ${contact}.`,
      heading: 'Un agente derivó una conversación',
      body1: (agent: string, contact: string) =>
        `${agent} se pausó en la conversación con ${contact} y está esperando que un humano la tome.`,
      body2: (reason: string) => `Motivo: ${reason}`,
      cta: 'Abrir la conversación',
      footnote:
        'Puedes desactivar estas notificaciones en la configuración del agente.',
    },
    trialEnding: {
      subject: 'Tu prueba gratuita de whathooks termina pronto',
      preheader: (date: string) =>
        `Tu prueba gratuita termina el ${date} — puedes cancelar antes cuando quieras.`,
      heading: 'Tu prueba gratuita termina pronto',
      body1: (plan: string, date: string) =>
        `Tu prueba gratuita de 7 días del plan ${plan} termina el ${date}. Si whathooks te está gustando, no necesitas hacer nada — tu suscripción comienza automáticamente.`,
      body2:
        '¿No te convenció? Cancela antes de que termine la prueba y no se te cobrará nada.',
      cta: 'Administrar tu suscripción',
      footnote:
        'Te enviamos este recordatorio para que el primer cobro nunca sea una sorpresa.',
    },
    invitation: {
      subject: (inviter: string, org: string) =>
        `${inviter} te invitó a unirte a ${org} en whathooks`,
      preheader: (org: string, expires: string) =>
        `Acepta tu invitación a ${org} — expira el ${expires}.`,
      heading: (org: string) => `Únete a ${org} en whathooks`,
      body1: (inviter: string, org: string, role: string) =>
        `${inviter} te invitó a unirte a ${org} en whathooks con el rol ${role}.`,
      body2:
        'whathooks conecta números de WhatsApp con webhooks, una API REST y una bandeja de entrada compartida para tu equipo.',
      cta: 'Aceptar la invitación',
      footnote: (expires: string) =>
        `Esta invitación expira el ${expires}. Si no la esperabas, puedes ignorar este correo.`,
      fallbackInviter: 'Alguien de tu equipo',
    },
  },
} as const;
