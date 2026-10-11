import { smtpSettings } from "../src/lib/mail-settings";
import { mailTransport } from "../src/lib/verification";
async function main() {
  const settings = smtpSettings();
  await mailTransport().verify();
  console.log(
    settings.host === "127.0.0.1" && settings.port === 1025
      ? "SMTP връзката е успешна. Това е локална тестова поща; писмата не се доставят до Gmail."
      : "SMTP връзката и удостоверяването са успешни. Приложението може да изпраща писма чрез настроения доставчик.",
  );
}
main().catch((error) => {
  console.error(
    "Неуспешна SMTP настройка:",
    error.code ??
      (error.message?.startsWith("Configure")
        ? error.message
        : "Провери SMTP настройките и достъпа."),
  );
  process.exitCode = 1;
});
