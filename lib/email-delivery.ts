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
        <img src="https://www.pcfbattle.be/PFB_Logo_Pink.svg" width="80" alt="Powerchair Floorball Battle Logo" style="display:block;">
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
          <a href="https://www.pcfbattle.be" title="PCF BATTLE website" aria-label="PCF BATTLE website" style="display:inline-block;width:22px;height:22px;line-height:22px;margin-right:5px;text-align:center;text-decoration:none;color:#ff1c83;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ff1c83" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg></a>
          <a href="https://www.facebook.com/pcfbattle" title="PCF BATTLE on Facebook" aria-label="PCF BATTLE on Facebook" style="display:inline-block;width:22px;height:22px;line-height:22px;margin-right:5px;text-align:center;text-decoration:none;color:#ff1c83;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;"><svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="16" height="16" style="display:inline-block;vertical-align:middle;fill:#ff1c83;"><title>Facebook</title><path d="M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647Z"/></svg></a>
          <a href="https://www.instagram.com/pcfbattle/" title="PCF BATTLE on Instagram" aria-label="PCF BATTLE on Instagram" style="display:inline-block;width:22px;height:22px;line-height:22px;text-align:center;text-decoration:none;color:#ff1c83;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;"><svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="16" height="16" style="display:inline-block;vertical-align:middle;fill:#ff1c83;"><title>Instagram</title><path d="M7.0301.084c-1.2768.0602-2.1487.264-2.911.5634-.7888.3075-1.4575.72-2.1228 1.3877-.6652.6677-1.075 1.3368-1.3802 2.127-.2954.7638-.4956 1.6365-.552 2.914-.0564 1.2775-.0689 1.6882-.0626 4.947.0062 3.2586.0206 3.6671.0825 4.9473.061 1.2765.264 2.1482.5635 2.9107.308.7889.72 1.4573 1.388 2.1228.6679.6655 1.3365 1.0743 2.1285 1.38.7632.295 1.6361.4961 2.9134.552 1.2773.056 1.6884.069 4.9462.0627 3.2578-.0062 3.668-.0207 4.9478-.0814 1.28-.0607 2.147-.2652 2.9098-.5633.7889-.3086 1.4578-.72 2.1228-1.3881.665-.6682 1.0745-1.3378 1.3795-2.1284.2957-.7632.4966-1.636.552-2.9124.056-1.2809.0692-1.6898.063-4.948-.0063-3.2583-.021-3.6668-.0817-4.9465-.0607-1.2797-.264-2.1487-.5633-2.9117-.3084-.7889-.72-1.4568-1.3876-2.1228C21.2982 1.33 20.628.9208 19.8378.6165 19.074.321 18.2017.1197 16.9244.0645 15.6471.0093 15.236-.005 11.977.0014 8.718.0076 8.31.0215 7.0301.0839m.1402 21.6932c-1.17-.0509-1.8053-.2453-2.2287-.408-.5606-.216-.96-.4771-1.3819-.895-.422-.4178-.6811-.8186-.9-1.378-.1644-.4234-.3624-1.058-.4171-2.228-.0595-1.2645-.072-1.6442-.079-4.848-.007-3.2037.0053-3.583.0607-4.848.05-1.169.2456-1.805.408-2.2282.216-.5613.4762-.96.895-1.3816.4188-.4217.8184-.6814 1.3783-.9003.423-.1651 1.0575-.3614 2.227-.4171 1.2655-.06 1.6447-.072 4.848-.079 3.2033-.007 3.5835.005 4.8495.0608 1.169.0508 1.8053.2445 2.228.408.5608.216.96.4754 1.3816.895.4217.4194.6816.8176.9005 1.3787.1653.4217.3617 1.056.4169 2.2263.0602 1.2655.0739 1.645.0796 4.848.0058 3.203-.0055 3.5834-.061 4.848-.051 1.17-.245 1.8055-.408 2.2294-.216.5604-.4763.96-.8954 1.3814-.419.4215-.8181.6811-1.3783.9-.4224.1649-1.0577.3617-2.2262.4174-1.2656.0595-1.6448.072-4.8493.079-3.2045.007-3.5825-.006-4.848-.0608M16.953 5.5864A1.44 1.44 0 1 0 18.39 4.144a1.44 1.44 0 0 0-1.437 1.4424M5.8385 12.012c.0067 3.4032 2.7706 6.1557 6.173 6.1493 3.4026-.0065 6.157-2.7701 6.1506-6.1733-.0065-3.4032-2.771-6.1565-6.174-6.1498-3.403.0067-6.156 2.771-6.1496 6.1738M8 12.0077a4 4 0 1 1 4.008 3.9921A3.9996 3.9996 0 0 1 8 12.0077"/></svg></a>
        </p>
      </td>
    </tr>
  </table>`;
const PCF_BATTLE_EMAIL_SOCIAL_LINKS = `<p style="margin:6px 0 0;font-size:12px;line-height:22px;">
          <a href="https://www.pcfbattle.be" title="PCF BATTLE website" aria-label="PCF BATTLE website" style="display:inline-block;width:22px;height:22px;line-height:22px;margin-right:5px;text-align:center;text-decoration:none;color:#ff1c83;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ff1c83" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg></a>
          <a href="https://www.facebook.com/pcfbattle" title="PCF BATTLE on Facebook" aria-label="PCF BATTLE on Facebook" style="display:inline-block;width:22px;height:22px;line-height:22px;margin-right:5px;text-align:center;text-decoration:none;color:#ff1c83;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;"><svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="16" height="16" style="display:inline-block;vertical-align:middle;fill:#ff1c83;"><title>Facebook</title><path d="M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647Z"/></svg></a>
          <a href="https://www.instagram.com/pcfbattle/" title="PCF BATTLE on Instagram" aria-label="PCF BATTLE on Instagram" style="display:inline-block;width:22px;height:22px;line-height:22px;text-align:center;text-decoration:none;color:#ff1c83;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;"><svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="16" height="16" style="display:inline-block;vertical-align:middle;fill:#ff1c83;"><title>Instagram</title><path d="M7.0301.084c-1.2768.0602-2.1487.264-2.911.5634-.7888.3075-1.4575.72-2.1228 1.3877-.6652.6677-1.075 1.3368-1.3802 2.127-.2954.7638-.4956 1.6365-.552 2.914-.0564 1.2775-.0689 1.6882-.0626 4.947.0062 3.2586.0206 3.6671.0825 4.9473.061 1.2765.264 2.1482.5635 2.9107.308.7889.72 1.4573 1.388 2.1228.6679.6655 1.3365 1.0743 2.1285 1.38.7632.295 1.6361.4961 2.9134.552 1.2773.056 1.6884.069 4.9462.0627 3.2578-.0062 3.668-.0207 4.9478-.0814 1.28-.0607 2.147-.2652 2.9098-.5633.7889-.3086 1.4578-.72 2.1228-1.3881.665-.6682 1.0745-1.3378 1.3795-2.1284.2957-.7632.4966-1.636.552-2.9124.056-1.2809.0692-1.6898.063-4.948-.0063-3.2583-.021-3.6668-.0817-4.9465-.0607-1.2797-.264-2.1487-.5633-2.9117-.3084-.7889-.72-1.4568-1.3876-2.1228C21.2982 1.33 20.628.9208 19.8378.6165 19.074.321 18.2017.1197 16.9244.0645 15.6471.0093 15.236-.005 11.977.0014 8.718.0076 8.31.0215 7.0301.0839m.1402 21.6932c-1.17-.0509-1.8053-.2453-2.2287-.408-.5606-.216-.96-.4771-1.3819-.895-.422-.4178-.6811-.8186-.9-1.378-.1644-.4234-.3624-1.058-.4171-2.228-.0595-1.2645-.072-1.6442-.079-4.848-.007-3.2037.0053-3.583.0607-4.848.05-1.169.2456-1.805.408-2.2282.216-.5613.4762-.96.895-1.3816.4188-.4217.8184-.6814 1.3783-.9003.423-.1651 1.0575-.3614 2.227-.4171 1.2655-.06 1.6447-.072 4.848-.079 3.2033-.007 3.5835.005 4.8495.0608 1.169.0508 1.8053.2445 2.228.408.5608.216.96.4754 1.3816.895.4217.4194.6816.8176.9005 1.3787.1653.4217.3617 1.056.4169 2.2263.0602 1.2655.0739 1.645.0796 4.848.0058 3.203-.0055 3.5834-.061 4.848-.051 1.17-.245 1.8055-.408 2.2294-.216.5604-.4763.96-.8954 1.3814-.419.4215-.8181.6811-1.3783.9-.4224.1649-1.0577.3617-2.2262.4174-1.2656.0595-1.6448.072-4.8493.079-3.2045.007-3.5825-.006-4.848-.0608M16.953 5.5864A1.44 1.44 0 1 0 18.39 4.144a1.44 1.44 0 0 0-1.437 1.4424M5.8385 12.012c.0067 3.4032 2.7706 6.1557 6.173 6.1493 3.4026-.0065 6.157-2.7701 6.1506-6.1733-.0065-3.4032-2.771-6.1565-6.174-6.1498-3.403.0067-6.156 2.771-6.1496 6.1738M8 12.0077a4 4 0 1 1 4.008 3.9921A3.9996 3.9996 0 0 1 8 12.0077"/></svg></a>
        </p>`;

function appendEmailSignature(html: string) {
  if (html.includes('title="PCF BATTLE on Instagram"')) return html;

  const alreadyHasOrganizerSignature =
    html.includes("Senne Brouwers") &&
    html.includes("Seppe Hemerijckx") &&
    html.includes("hello@pcfbattle.be");
  const signature = alreadyHasOrganizerSignature
    ? PCF_BATTLE_EMAIL_SOCIAL_LINKS
    : PCF_BATTLE_EMAIL_SIGNATURE;

  const lowerHtml = html.toLowerCase();
  const bodyEnd = lowerHtml.lastIndexOf("</body>");
  if (bodyEnd >= 0) {
    return html.slice(0, bodyEnd) + signature + html.slice(bodyEnd);
  }
  const htmlEnd = lowerHtml.lastIndexOf("</html>");
  if (htmlEnd >= 0) {
    return html.slice(0, htmlEnd) + signature + html.slice(htmlEnd);
  }
  return html + signature;
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
      body: JSON.stringify({ from, to, subject, html: appendEmailSignature(html) }),
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
