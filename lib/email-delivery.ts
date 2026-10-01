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
      body: JSON.stringify({ from, to, subject, html }),
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
