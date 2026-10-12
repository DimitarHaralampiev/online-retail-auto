"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useLocale } from "./locale-provider";

type Result = {
  answer: string;
  mode: string;
  snapshot: {
    includesTestOrders: boolean;
    days: number;
    orders: { orders: number };
    warehouse: {
      products: number;
      free_units: string;
      acquisition_value_cents: string;
    };
    stockTruncated: boolean;
  };
  reorder: { sku: string; quantity: number; reason: string }[];
  sources: { id: string; title: string; url: string }[];
};
export default function BusinessChat() {
  const { locale, t } = useLocale();
  const en = locale === "en";
  const label = (bg: string, eng: string) => (en ? eng : bg);
  const [question, setQuestion] = useState("");
  const [days, setDays] = useState(30);
  const [includeTest, setIncludeTest] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState("");
  const [messages, setMessages] = useState<
    { question: string; result: Result }[]
  >([]);
  const input = useRef<HTMLTextAreaElement>(null);
  const lock = useRef(false);
  const thread = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (thread.current) thread.current.scrollTop = thread.current.scrollHeight;
  }, [messages.length, busy]);
  const prompts = [
    {
      mark: "01",
      title: label("Наличности", "Inventory"),
      question: label(
        "Какви наличности имам и кои артикули са на изчерпване?",
        "What stock do I have and which items are running low?",
      ),
    },
    {
      mark: "02",
      title: label("Зареждане", "Replenishment"),
      question: label(
        "Кои артикули трябва да заредя и в какви количества?",
        "Which items should I replenish and in what quantities?",
      ),
    },
    {
      mark: "03",
      title: label("Продажби", "Sales"),
      question: label(
        "Обобщи поръчките за избрания период.",
        "Summarise orders for the selected period.",
      ),
    },
    {
      mark: "04",
      title: label("Промоции", "Promotions"),
      question: label(
        "За кои продукти е подходяща промоция и какви данни липсват за решение?",
        "Which products could benefit from a promotion and what data is missing?",
      ),
    },
  ];
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const q = question.trim();
    if (lock.current || q.length < 3) return;
    lock.current = true;
    setBusy(true);
    setPending(q);
    setError("");
    try {
      const r = await fetch("/api/admin/insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, days, includeTest, locale }),
      });
      const data = await r.json();
      if (!r.ok)
        throw Error(
          data.error ||
            label(
              "Анализът е неуспешен. Опитай отново.",
              "Analysis failed. Try again.",
            ),
        );
      setMessages((old) => [...old, { question: q, result: data }]);
      setQuestion("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      lock.current = false;
      setPending("");
    }
  }
  const latest = messages.at(-1)?.result;
  const metrics = [
    {
      label: label("Артикули в склада", "Warehouse products"),
      value: latest?.snapshot.warehouse.products,
    },
    {
      label: label("Свободни бройки", "Available units"),
      value: latest?.snapshot.warehouse.free_units,
    },
    {
      label: label("Поръчки за периода", "Orders in period"),
      value: latest?.snapshot.orders.orders,
    },
    {
      label: label("Стойност на склада", "Inventory value"),
      value: latest
        ? new Intl.NumberFormat(en ? "en-IE" : "bg-BG", {
            style: "currency",
            currency: "EUR",
          }).format(
            Number(latest.snapshot.warehouse.acquisition_value_cents) / 100,
          )
        : undefined,
    },
  ];
  return (
    <div className="insights-workspace">
      <aside className="insights-sidebar">
        <div className="insights-brand">
          <span className="insights-orbit" aria-hidden="true">
            ✦
          </span>
          <div>
            <strong>AUTO / INTELLIGENCE</strong>
            <span>
              {label("Твоят бизнес, по-ясно.", "Your business, made clearer.")}
            </span>
          </div>
        </div>
        <div className="insights-section-label">
          {label("РАБОТНО ПРОСТРАНСТВО", "WORKSPACE")}
        </div>
        <nav
          className="insights-links"
          aria-label={label("Административни инструменти", "Admin tools")}
        >
          <Link href="/admin/insights" aria-current="page">
            ↗ {label("Аналитика / ИИ", "Analytics / AI")}
          </Link>
          <Link href="/admin/invoices">
            ▤ {label("Фактури и склад", "Invoices & stock")}
          </Link>
          <Link href="/admin/products">
            ▧ {label("Продукти и медия", "Products & media")}
          </Link>
          <Link href="/admin/orders">≡ {label("Поръчки", "Orders")}</Link>
          <Link href="/admin/settings">
            ⚙ {label("Настройки", "Settings")}
          </Link>
        </nav>
        <div className="insights-scope">
          <div className="insights-section-label">
            {label("ОБХВАТ НА СЛЕДВАЩИЯ АНАЛИЗ", "NEXT ANALYSIS SCOPE")}
          </div>
          <label htmlFor="insight-period">{label("Период", "Period")}</label>
          <select
            id="insight-period"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            disabled={busy}
          >
            {[7, 30, 90, 365].map((d) => (
              <option key={d} value={d}>
                {d} {label("дни", "days")}
              </option>
            ))}
          </select>
          <label className="insights-test-toggle">
            <input
              type="checkbox"
              checked={includeTest}
              onChange={(e) => setIncludeTest(e.target.checked)}
              disabled={busy}
            />
            <span>
              {label("Включи тестови поръчки", "Include test orders")}
            </span>
          </label>
          <p>
            {label(
              "Избраният период важи за поръчките. Наличностите са текущи.",
              "The period applies to orders. Stock reflects current quantities.",
            )}
          </p>
        </div>
        <div className="insights-private">
          <span aria-hidden="true">◈</span>
          <div>
            <strong>
              {label("Само за администратора", "Admin access only")}
            </strong>
            <p>
              {label(
                "Справки от твоята база. Ти вземаш решенията.",
                "Reports from your database. You make the decisions.",
              )}
            </p>
          </div>
        </div>
      </aside>
      <section className="insights-main" aria-labelledby="insights-title">
        <header className="insights-heading">
          <div>
            <p className="insights-section-label">
              {label("ОТ ДАННИ КЪМ РЕШЕНИЯ", "FROM DATA TO DECISIONS")}
            </p>
            <h1 id="insights-title">
              {label("Попитай бизнеса си.", "Ask your business.")}
            </h1>
            <p>
              {label(
                "Наличности, продажби и следващата добра стъпка — в един разговор.",
                "Inventory, sales and your next move — in one conversation.",
              )}
            </p>
          </div>
          <span className="insights-status">
            <i />
            {label("Защитено пространство", "Private workspace")}
          </span>
        </header>
        <div className="insights-metrics">
          {metrics.map((m) => (
            <div key={m.label}>
              <span>{m.label}</span>
              <strong>{m.value ?? "—"}</strong>
              <small>
                {latest
                  ? label("От последната справка", "From the latest report")
                  : label("След първия анализ", "After your first analysis")}
              </small>
            </div>
          ))}
        </div>
        <div className="insights-conversation">
          <div className="insights-chat-heading">
            <h2>{label("Бизнес асистент", "Business assistant")}</h2>
            <span>
              {messages.length} {label("справки", "reports")}
            </span>
          </div>
          {!messages.length && !busy && (
            <div className="insights-welcome">
              <span className="insights-welcome-mark" aria-hidden="true">
                ✦
              </span>
              <h3>
                {label(
                  "Какво искаш да разбереш?",
                  "What would you like to know?",
                )}
              </h3>
              <p>
                {label(
                  "Пиши със свои думи или започни с един от въпросите.",
                  "Ask in your own words or start with a suggested question.",
                )}
              </p>
              <div className="insights-prompts">
                {prompts.map((p) => (
                  <button
                    key={p.mark}
                    type="button"
                    onClick={() => {
                      setQuestion(p.question);
                      input.current?.focus();
                    }}
                  >
                    <span>
                      {p.mark} / {p.title}
                    </span>
                    <strong>{p.question}</strong>
                    <i aria-hidden="true">↗</i>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div
            ref={thread}
            className="insights-thread"
            aria-live="polite"
            aria-busy={busy}
          >
            {messages.map((m, i) => (
              <article key={i} className="insights-turn">
                <div className="insights-user-question">
                  <span>{label("ТВОЯТ ВЪПРОС", "YOUR QUESTION")}</span>
                  <p>{m.question}</p>
                </div>
                <div className="insights-answer">
                  <div className="insights-answer-header">
                    <span className="insights-avatar" aria-hidden="true">
                      ✦
                    </span>
                    <strong>
                      {m.result.mode === "ai"
                        ? label("ИИ анализ", "AI analysis")
                        : label("Изчислена справка", "Calculated report")}
                    </strong>
                    <small>
                      {m.result.snapshot.days} {label("дни", "days")} ·{" "}
                      {m.result.snapshot.includesTestOrders
                        ? label("с тестови поръчки", "including test orders")
                        : label("без тестови поръчки", "excluding test orders")}
                    </small>
                  </div>
                  <div className="insights-answer-text">
                    {m.result.answer
                      .split(/\n\s*\n/)
                      .filter(Boolean)
                      .map((p, n) => (
                        <p key={n}>{p}</p>
                      ))}
                  </div>
                  {!!m.result.reorder.length && (
                    <details className="insights-details">
                      <summary>
                        {label(
                          "Предложения за зареждане",
                          "Replenishment suggestions",
                        )}{" "}
                        <span>{m.result.reorder.length}</span>
                      </summary>
                      <div className="insights-table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>SKU</th>
                              <th>
                                {label("Бройки до целта", "Units to target")}
                              </th>
                              <th>{label("Основание", "Reason")}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {m.result.reorder.map((p) => (
                              <tr key={p.sku}>
                                <td>{p.sku}</td>
                                <td>{p.quantity}</td>
                                <td>{t(p.reason)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </details>
                  )}
                  {!!m.result.sources.length && (
                    <details className="insights-details">
                      <summary>
                        {label("Източници на справката", "Report sources")}{" "}
                        <span>{m.result.sources.length}</span>
                      </summary>
                      <ul className="insights-sources">
                        {m.result.sources.map((s) => (
                          <li key={s.id}>
                            <a href={s.url}>
                              {t(s.title)} <span aria-hidden="true">↗</span>
                            </a>
                            <small>{s.id}</small>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                  {m.result.snapshot.stockTruncated && (
                    <p className="insights-note">
                      {label(
                        "Подробностите включват до 100 артикула. Общите суми включват всички.",
                        "Detail covers up to 100 items. Totals include all products.",
                      )}
                    </p>
                  )}
                  {m.result.mode !== "ai" && (
                    <p className="insights-note">
                      {label(
                        "ИИ не е конфигуриран. Това е изчислена обзорна справка.",
                        "AI is not configured. This is a calculated overview.",
                      )}
                    </p>
                  )}
                </div>
              </article>
            ))}
            {busy && (
              <div className="insights-loading" role="status">
                <span className="insights-avatar" aria-hidden="true">
                  ✦
                </span>
                <div>
                  <strong>
                    {label("Проверявам данните…", "Checking the data…")}
                  </strong>
                  <p>{pending}</p>
                </div>
                <span className="insights-loading-dots" aria-hidden="true">
                  •••
                </span>
              </div>
            )}
          </div>
          <form className="insights-composer" onSubmit={submit}>
            <label
              className="insights-section-label"
              htmlFor="insight-question"
            >
              {label("ТВОЯТ ВЪПРОС", "YOUR QUESTION")}
            </label>
            <textarea
              ref={input}
              id="insight-question"
              required
              minLength={3}
              maxLength={2000}
              rows={3}
              value={question}
              disabled={busy}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder={label(
                "Например: Кои продукти трябва да заредя тази седмица?",
                "For example: Which products should I replenish this week?",
              )}
            />
            <div className="insights-composer-bottom">
              <span>{question.length}/2000</span>
              <button
                type="submit"
                disabled={busy || question.trim().length < 3}
              >
                {busy
                  ? label("Анализираме…", "Analysing…")
                  : label("Анализирай", "Analyse")}{" "}
                <span aria-hidden="true">↗</span>
              </button>
            </div>
            {error && (
              <p className="insights-error" role="alert">
                {t(error)}
              </p>
            )}
          </form>
          <p className="insights-footnote">
            {label(
              "Предложенията не променят автоматично цени или наличности. Печалбата изисква проверени разходи и реални продажби.",
              "Suggestions do not automatically change prices or stock. Profit requires verified costs and real sales.",
            )}
          </p>
        </div>
      </section>
    </div>
  );
}
