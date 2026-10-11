export function smtpSettings(
  env: Record<string, string | undefined> = process.env,
) {
  const host = env.SMTP_HOST?.trim();
  const from = env.SMTP_FROM?.trim();
  if (!host || !from) throw new Error("Configure SMTP_HOST and SMTP_FROM");
  const secure = env.SMTP_SECURE === "true";
  const port = Number(env.SMTP_PORT ?? (secure ? 465 : 587));
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Configure a valid SMTP_PORT");
  const user = env.SMTP_USER?.trim();
  const password = env.SMTP_PASSWORD;
  if (Boolean(user) !== Boolean(password))
    throw new Error("Configure both SMTP_USER and SMTP_PASSWORD");
  const local = ["localhost", "127.0.0.1", "::1"].includes(host.toLowerCase());
  return {
    host,
    from,
    port,
    secure,
    requireTLS: !secure && (!local || env.NODE_ENV === "production"),
    auth: user
      ? {
          user,
          pass:
            host.toLowerCase() === "smtp.gmail.com"
              ? password!.replace(/\s/g, "")
              : password!,
        }
      : undefined,
  };
}
