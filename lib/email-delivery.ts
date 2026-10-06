export type EmailDeliveryResult =
  | { ok: true; providerMessageId?: string }
  | {
      ok: false;
      reason: "missing_configuration" | "provider_rejected" | "network_error";
      status?: number;
      providerCode?: string;
      errorName?: string;
    };

type DeliverEmailInput = {
  apiKey?: string;
  from?: string;
  to?: string;
  subject: string;
  html: string;
  fetcher?: typeof fetch;
};

function safeProviderCode(value: unknown) {
  if (typeof value !== "string" || !/^[a-z0-9_.-]{1,64}$/i.test(value)) return undefined;
  return value;
}

const PCF_BATTLE_EMAIL_SIGNATURE = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;border-spacing:0;font-family:Arial,Helvetica,sans-serif;">
    <tr>
      <td style="padding:0 16px 0 0;vertical-align:middle;">
        <img src="https://www.pcfbattle.be/email-signature-logo.png" width="80" alt="Powerchair Floorball Battle Logo" style="display:block;">
      </td>
      <td aria-hidden="true" style="width:2px;padding:0;background-color:#ff1c83;font-size:0;line-height:0;">
        <div style="width:2px;height:80px;">&nbsp;</div>
      </td>
      <td style="padding:0 0 0 16px;vertical-align:middle;">
        <p style="margin:0 0 3px;font-size:16px;font-weight:bold;line-height:20px;color:#000000;">Senne Brouwers &amp; Seppe Hemerijckx</p>
        <p style="margin:0 0 8px;font-size:12px;font-weight:bold;line-height:16px;letter-spacing:0.5px;text-transform:uppercase;color:#ff1c83;">Organizers</p>
        <p style="margin:0 0 6px;font-size:13px;font-weight:bold;line-height:17px;letter-spacing:0.3px;color:#000000;">POWERCHAIR FLOORBALL BATTLE</p>
        <p style="margin:0;font-size:12px;line-height:16px;color:#333333;"><a href="mailto:hello@pcfbattle.be" style="color:#ff1c83;text-decoration:none;font-weight:bold;">hello@pcfbattle.be</a></p>
        <p style="margin:6px 0 0;font-size:12px;line-height:22px;">
          <a href="https://www.pcfbattle.be" title="PCF BATTLE website" aria-label="PCF BATTLE website" style="display:inline-block;width:22px;height:22px;line-height:22px;margin-right:5px;text-align:center;text-decoration:none;color:#ff1c83;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;"><img src="https://www.pcfbattle.be/email-signature-website.png" width="16" height="16" alt="Website icon" style="display:inline-block;vertical-align:middle;border:0;"></a>
          <a href="https://www.facebook.com/pcfbattle" title="PCF BATTLE on Facebook" aria-label="PCF BATTLE on Facebook" style="display:inline-block;width:22px;height:22px;line-height:22px;margin-right:5px;text-align:center;text-decoration:none;color:#ff1c83;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;"><img src="https://www.pcfbattle.be/email-signature-facebook.png" width="16" height="16" alt="Facebook icon" style="display:inline-block;vertical-align:middle;border:0;"></a>
          <a href="https://www.instagram.com/pcfbattle/" title="PCF BATTLE on Instagram" aria-label="PCF BATTLE on Instagram" style="display:inline-block;width:22px;height:22px;line-height:22px;text-align:center;text-decoration:none;color:#ff1c83;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;"><img src="https://www.pcfbattle.be/email-signature-instagram.png" width="16" height="16" alt="Instagram icon" style="display:inline-block;vertical-align:middle;border:0;"></a>
        </p>
      </td>
    </tr>
  </table>`;
const PCF_BATTLE_EMAIL_SOCIAL_LINKS = `<p style="margin:6px 0 0;font-size:12px;line-height:22px;">
          <a href="https://www.pcfbattle.be" title="PCF BATTLE website" aria-label="PCF BATTLE website" style="display:inline-block;width:22px;height:22px;line-height:22px;margin-right:5px;text-align:center;text-decoration:none;color:#ff1c83;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;"><img src="https://www.pcfbattle.be/email-signature-website.png" width="16" height="16" alt="Website icon" style="display:inline-block;vertical-align:middle;border:0;"></a>
          <a href="https://www.facebook.com/pcfbattle" title="PCF BATTLE on Facebook" aria-label="PCF BATTLE on Facebook" style="display:inline-block;width:22px;height:22px;line-height:22px;margin-right:5px;text-align:center;text-decoration:none;color:#ff1c83;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;"><img src="https://www.pcfbattle.be/email-signature-facebook.png" width="16" height="16" alt="Facebook icon" style="display:inline-block;vertical-align:middle;border:0;"></a>
          <a href="https://www.instagram.com/pcfbattle/" title="PCF BATTLE on Instagram" aria-label="PCF BATTLE on Instagram" style="display:inline-block;width:22px;height:22px;line-height:22px;text-align:center;text-decoration:none;color:#ff1c83;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;"><img src="https://www.pcfbattle.be/email-signature-instagram.png" width="16" height="16" alt="Instagram icon" style="display:inline-block;vertical-align:middle;border:0;"></a>
        </p>`;

function appendEmailSignature(html: string) {
  if (html.includes('title="PCF BATTLE on Instagram"')) return html;

  const alreadyHasOrganizerSignature =
    html.includes("Senne Brouwers") &&
    html.includes("Seppe Hemerijckx") &&
    html.includes("hello@pcfbattle.be");

  if (alreadyHasOrganizerSignature) {
    const emailLineEnd = html.indexOf("</a></div>", html.indexOf('href="mailto:hello@pcfbattle.be"'));
    const signatureCellEnd = emailLineEnd >= 0 ? html.indexOf("</td>", emailLineEnd) : -1;
    if (signatureCellEnd >= 0) {
      return html.slice(0, signatureCellEnd) + PCF_BATTLE_EMAIL_SOCIAL_LINKS + html.slice(signatureCellEnd);
    }
  }

  const signature = alreadyHasOrganizerSignature
    ? PCF_BATTLE_EMAIL_SOCIAL_LINKS
    : PCF_BATTLE_EMAIL_SIGNATURE;
  const lowerHtml = html.toLowerCase();
  const bodyEnd = lowerHtml.lastIndexOf("</body>");
  if (bodyEnd >= 0) return html.slice(0, bodyEnd) + signature + html.slice(bodyEnd);
  const htmlEnd = lowerHtml.lastIndexOf("</html>");
  if (htmlEnd >= 0) return html.slice(0, htmlEnd) + signature + html.slice(htmlEnd);
  return html + signature;
}

function applyEmailBrandPink(html: string) {
  return html
    .replaceAll("#ff1c83", "#FF2992")
    .replaceAll("#ec4899", "#FF2992")
    .replaceAll("#ec1970", "#FF2992")
    .replaceAll("#db2777", "#FF2992");
}

export async function deliverEmail({
  apiKey,
  from,
  to,
  subject,
  html,
  fetcher = fetch,
}: DeliverEmailInput): Promise<EmailDeliveryResult> {
  if (!apiKey || !from || !to) return { ok: false, reason: "missing_configuration" };

  try {
    const response = await fetcher("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to, subject, html: applyEmailBrandPink(appendEmailSignature(html)) }),
      signal: AbortSignal.timeout(8_000),
    });
    const responseBody = await response.json().catch(() => null) as Record<string, unknown> | null;

    if (!response.ok) {
      const providerCode = safeProviderCode(responseBody?.name) || safeProviderCode(responseBody?.code);
      return {
        ok: false,
        reason: "provider_rejected",
        status: response.status,
        ...(providerCode ? { providerCode } : {}),
      };
    }

    const providerMessageId = typeof responseBody?.id === "string" &&
      /^[a-z0-9_-]{1,160}$/i.test(responseBody.id)
      ? responseBody.id
      : undefined;
    return { ok: true, ...(providerMessageId ? { providerMessageId } : {}) };
  } catch (error) {
    return {
      ok: false,
      reason: "network_error",
      errorName: error instanceof Error && /^[a-z0-9_-]{1,64}$/i.test(error.name)
        ? error.name
        : "UnknownError",
    };
  }
}
