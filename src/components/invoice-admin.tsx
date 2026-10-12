"use client";
import Localize from "./localize";
import { useLocale } from "./locale-provider";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { formatMoney } from "../lib/cart";
import {
  acquisitionCosts,
  defaultPricingAssumptions,
  priceScenario,
  reviewedInvoiceSchema,
  identityMatches,
  type ReviewedInvoice,
  type InvoiceLine,
  type ExtractedInvoice,
  type PricingAssumptions,
} from "../lib/invoice-rules";
type Draft = Omit<ReviewedInvoice, "confirmed">;
type Offer = {
  shop: string;
  url: string;
  title: string;
  brand: string | null;
  manufacturerCode: string | null;
  ean: string | null;
  packQuantity: number | null;
  price: number | null;
  currency: string;
  availability: string;
  includesVat: boolean | null;
  shippingNote: string;
  evidence: string;
  identityMatched: boolean;
  usableForComparison: boolean;
};
type Research = {
  offers: Offer[];
  summary: string;
  checkedAt: string;
  needsHumanReview: boolean;
};
type Invoice = {
  id: string;
  filename: string;
  status: string;
  parse_status: string;
  extracted: ExtractedInvoice | null;
  reviewed: ReviewedInvoice | null;
  pricing_assumptions?: PricingAssumptions | null;
  research?: {
    product_identity: Pick<
      InvoiceLine,
      "name" | "brand" | "manufacturerCode" | "ean"
    >;
    result: Research;
  }[];
};
type StockRow = {
  sku: string;
  name: string;
  on_hand: number;
  reserved: number;
  inventory_value_cents: string;
};
const blankLine = (): InvoiceLine => ({
  sku: "",
  name: "",
  brand: "",
  manufacturerCode: "",
  ean: "",
  quantity: 1,
  unitNetCents: 0,
  purchaseVatBps: 2000,
});
const blankDraft = (): Draft => ({
  supplierName: "",
  supplierTaxId: "",
  invoiceNumber: "",
  invoiceDate: "",
  currency: "EUR",
  exchangeRate: 1,
  netTotalCents: 0,
  purchaseVatTotalCents: 0,
  inboundShippingCents: 0,
  otherAcquisitionCents: 0,
  recoverPurchaseVat: true,
  lines: [],
});
const money = (amount: number) => Math.round(amount * 100);
const identity = (
  line: Pick<InvoiceLine, "brand" | "manufacturerCode" | "ean">,
) => JSON.stringify([line.brand, line.manufacturerCode, line.ean]);
function fromExtracted(e: ExtractedInvoice): Draft {
  return {
    ...blankDraft(),
    supplierName: e.supplierName ?? "",
    supplierTaxId: e.supplierTaxId ?? "",
    invoiceNumber: e.invoiceNumber ?? "",
    invoiceDate: e.invoiceDate ?? "",
    currency: e.currency === "BGN" ? "BGN" : "EUR",
    exchangeRate: e.currency === "BGN" ? 0 : 1,
    netTotalCents: money(e.netTotal ?? 0),
    purchaseVatTotalCents: money(e.vatTotal ?? 0),
    lines: e.lines.map((l) => ({
      sku: "",
      name: l.description ?? "",
      brand: l.brand ?? "",
      manufacturerCode: l.manufacturerCode ?? "",
      ean: l.ean ?? "",
      quantity:
        /^(бр\.?|броя|брой|pcs?\.?|pieces?|ea|unit)$/i.test(
          l.unit?.trim() ?? "",
        ) && Number.isInteger(l.quantity)
          ? l.quantity!
          : 0,
      unitNetCents: money(l.unitNetPrice ?? 0),
      purchaseVatBps: Math.round((l.vatRate ?? 0) * 100),
    })),
  };
}
function Amount({
  label,
  value,
  onChange,
  percent = false,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  percent?: boolean;
}) {
  return (
    <Localize>
      {
        <label>
          {label}
          <input
            type="number"
            min="0"
            step={percent ? "0.01" : "0.01"}
            value={value / 100}
            onChange={(e) => onChange(Math.round(Number(e.target.value) * 100))}
          />
        </label>
      }
    </Localize>
  );
}
export default function InvoiceAdmin() {
  const { locale } = useLocale();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [stock, setStock] = useState<StockRow[]>([]);
  const [ai, setAi] = useState(false);
  const [active, setActive] = useState<Invoice | null>(null);
  const [draft, setDraft] = useState<Draft>(blankDraft);
  const [settings, setSettings] = useState<PricingAssumptions>(
    defaultPricingAssumptions,
  );
  const [research, setResearch] = useState<Record<string, Research>>({});
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  async function api(path: string, options?: RequestInit) {
    const r = await fetch(path, { cache: "no-store", ...options });
    const value = await r.json();
    if (!r.ok) throw new Error(value.error);
    return value;
  }
  async function refresh() {
    const value = await api("/api/admin/invoices");
    setInvoices(value.invoices);
    setStock(value.products);
    setAi(value.aiConfigured);
  }
  useEffect(() => {
    let alive = true;
    api("/api/admin/invoices")
      .then((value) => {
        if (alive) {
          setInvoices(value.invoices);
          setStock(value.products);
          setAi(value.aiConfigured);
          setSettings(value.pricingSettings);
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, []);
  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await task();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function populate(invoice: Invoice) {
    if (invoice.pricing_assumptions) setSettings(invoice.pricing_assumptions);
    setActive(invoice);
    setConfirmed(false);
    setDraft(
      invoice.reviewed ??
        (invoice.extracted ? fromExtracted(invoice.extracted) : blankDraft()),
    );
    const saved: Record<string, Research> = {};
    for (const r of invoice.research ?? [])
      if (!saved[identity(r.product_identity)])
        saved[identity(r.product_identity)] = r.result;
    setResearch(saved);
  }
  async function open(id: string) {
    await run(async () => populate(await api(`/api/admin/invoices/${id}`)));
  }
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const file = data.get("invoice");
    if (!(file instanceof File) || file.size > 10 * 1024 * 1024) {
      setError("Избери PDF до 10 MB.");
      return;
    }
    await run(async () => {
      const result = await api("/api/admin/invoices", {
        method: "POST",
        body: data,
      });
      populate(await api(`/api/admin/invoices/${result.id}`));
      await refresh();
      setMessage(
        result.duplicate
          ? "Файлът вече е качен. Отворихме съществуващата фактура."
          : "PDF е запазен. Избери „Разчети с ИИ“ или попълни данните ръчно.",
      );
      form.reset();
    });
  }
  async function action(value: unknown) {
    return api(`/api/admin/invoices/${active!.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(value),
    });
  }
  function changeLine(index: number, value: Partial<InvoiceLine>) {
    setConfirmed(false);
    setDraft((d) => ({
      ...d,
      lines: d.lines.map((l, i) => (i === index ? { ...l, ...value } : l)),
    }));
  }
  function change(value: Partial<Draft>) {
    setConfirmed(false);
    setDraft((d) => ({ ...d, ...value }));
  }
  const validation = reviewedInvoiceSchema.safeParse({
    ...draft,
    confirmed: true,
  });
  const costs = validation.success ? acquisitionCosts(validation.data) : [];
  const locked = busy || active?.status === "posted";
  return (
    <Localize>
      {
        <section className="invoice-admin">
          <div aria-live="polite">
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            {message && <p>{message}</p>}
            {busy && (
              <p role="status">
                Обработваме… ИИ анализът може да отнеме до няколко минути.
              </p>
            )}
          </div>
          <section className="customer-form-panel">
            <h2>1. Качи фактура</h2>
            <p>PDF до 10 MB. Документите са достъпни само за администратори.</p>
            <form className="customer-inline-actions" onSubmit={upload}>
              <input
                aria-label="PDF фактура"
                type="file"
                name="invoice"
                accept="application/pdf,.pdf"
                required
                disabled={busy}
              />
              <button className="button" disabled={busy}>
                Качи PDF
              </button>
            </form>
            <p className="note">
              При „Разчети с ИИ“ документът се изпраща на OpenAI за обработка.
              Качи само документи, които имаш право да обработваш.{" "}
              {ai
                ? "ИИ е конфигуриран."
                : "ИИ не е конфигуриран — нужен е API ключ в защитената конфигурация. Ръчното въвеждане работи."}
            </p>
          </section>
          <div className="invoice-history">
            <h3>Последни фактури</h3>
            {!invoices.length && <p>Още няма качени фактури.</p>}
            {invoices.map((i) => (
              <button
                className="invoice-history-item"
                disabled={busy}
                key={i.id}
                onClick={() => open(i.id)}
              >
                {i.filename}
                <small>
                  {i.status === "posted" ? "Заприходена" : "За преглед"}
                </small>
              </button>
            ))}
          </div>
          {active && (
            <section className="invoice-review">
              <div className="customer-inline-actions">
                <h2>2. Преглед: {active.filename}</h2>
                <a
                  className="text-link"
                  href={`/api/admin/invoices/${active.id}?download=pdf`}
                >
                  Изтегли оригинала
                </a>
                <button
                  className="button button-light"
                  disabled={locked || !ai}
                  onClick={() =>
                    run(async () => {
                      populate(await action({ action: "extract" }));
                      await refresh();
                      setMessage(
                        "ИИ извлече данните. Провери всички редове и суми преди заприхождаване.",
                      );
                    })
                  }
                >
                  Разчети с ИИ
                </button>
              </div>
              {active.status === "posted" && (
                <p role="status">
                  Фактурата вече е заприходена. Повторно добавяне на наличност е
                  блокирано.
                </p>
              )}
              {active.extracted && (
                <div className="invoice-ai-notes">
                  <h3>Проверки от ИИ</h3>
                  <p>
                    Вид документ: {active.extracted.documentType} · Валута:{" "}
                    {active.extracted.currency}
                  </p>
                  <ul>
                    {active.extracted.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                  <p className="note">
                    Неясните мерни единици се зареждат с количество 0. Попълни
                    брой продаваеми единици. Не заприхождавай транспортни
                    услуги, депозити и кредитни известия като стока.
                  </p>
                </div>
              )}
              <fieldset disabled={locked} className="invoice-fieldset">
                <div className="invoice-meta customer-form">
                  <label>
                    Доставчик
                    <input
                      value={draft.supplierName}
                      maxLength={160}
                      onChange={(e) => change({ supplierName: e.target.value })}
                    />
                  </label>
                  <label>
                    ЕИК / ДДС номер на доставчика
                    <input
                      value={draft.supplierTaxId}
                      maxLength={160}
                      onChange={(e) =>
                        change({ supplierTaxId: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    Номер на фактурата
                    <input
                      value={draft.invoiceNumber}
                      maxLength={160}
                      onChange={(e) =>
                        change({ invoiceNumber: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    Дата
                    <input
                      type="date"
                      value={draft.invoiceDate}
                      onChange={(e) => change({ invoiceDate: e.target.value })}
                    />
                  </label>
                  <label>
                    Валута на фактурата
                    <select
                      value={draft.currency}
                      onChange={(e) =>
                        change({
                          currency: e.target.value as "EUR" | "BGN",
                          exchangeRate: e.target.value === "EUR" ? 1 : 0,
                        })
                      }
                    >
                      <option>EUR</option>
                      <option>BGN</option>
                    </select>
                  </label>
                  <label>
                    EUR за единица валута
                    <input
                      type="number"
                      min="0.000001"
                      step="0.000001"
                      value={draft.exchangeRate}
                      onChange={(e) =>
                        change({ exchangeRate: Number(e.target.value) })
                      }
                    />
                  </label>
                  <Amount
                    label="Нетна сума за стоките (валута на фактурата)"
                    value={draft.netTotalCents}
                    onChange={(n) => change({ netTotalCents: n })}
                  />
                  <Amount
                    label="ДДС за стоките (валута на фактурата)"
                    value={draft.purchaseVatTotalCents}
                    onChange={(n) => change({ purchaseVatTotalCents: n })}
                  />
                  <Amount
                    label="Транспорт до склада (разход в EUR)"
                    value={draft.inboundShippingCents}
                    onChange={(n) => change({ inboundShippingCents: n })}
                  />
                  <Amount
                    label="Други разходи за придобиване (EUR)"
                    value={draft.otherAcquisitionCents}
                    onChange={(n) => change({ otherAcquisitionCents: n })}
                  />
                  <label className="product-alert-toggle">
                    <input
                      type="checkbox"
                      checked={draft.recoverPurchaseVat}
                      onChange={(e) =>
                        change({ recoverPurchaseVat: e.target.checked })
                      }
                    />{" "}
                    Покупното ДДС е възстановимо
                  </label>
                </div>
                <p className="note">
                  Единичните цени са без ДДС, след отстъпки. Разходите до склада
                  се разпределят по нетната стойност на редовете. Въведи
                  икономическия разход след приложимия данъчен кредит;
                  съгласувай ДДС настройките със счетоводителя.
                </p>
                <div className="invoice-line-list">
                  {draft.lines.map((line, index) => (
                    <article className="invoice-line" key={index}>
                      <div className="customer-inline-actions">
                        <h3>Ред {index + 1}</h3>
                        <button
                          className="text-link"
                          onClick={() =>
                            change({
                              lines: draft.lines.filter((_, i) => i !== index),
                            })
                          }
                        >
                          Премахни реда
                        </button>
                      </div>
                      <div className="invoice-meta customer-form">
                        <label>
                          Твоят SKU
                          <input
                            value={line.sku}
                            maxLength={60}
                            onChange={(e) =>
                              changeLine(index, { sku: e.target.value })
                            }
                          />
                        </label>
                        <label>
                          Име на продукта
                          <input
                            value={line.name}
                            maxLength={160}
                            onChange={(e) =>
                              changeLine(index, { name: e.target.value })
                            }
                          />
                        </label>
                        <label>
                          Марка
                          <input
                            value={line.brand}
                            maxLength={80}
                            onChange={(e) =>
                              changeLine(index, { brand: e.target.value })
                            }
                          />
                        </label>
                        <label>
                          Каталожен номер на производителя
                          <input
                            value={line.manufacturerCode}
                            maxLength={80}
                            onChange={(e) =>
                              changeLine(index, {
                                manufacturerCode: e.target.value,
                              })
                            }
                          />
                        </label>
                        <label>
                          EAN
                          <input
                            value={line.ean}
                            maxLength={14}
                            onChange={(e) =>
                              changeLine(index, { ean: e.target.value })
                            }
                          />
                        </label>
                        <label>
                          Количество (продаваеми единици)
                          <input
                            type="number"
                            min="1"
                            step="1"
                            value={line.quantity}
                            onChange={(e) =>
                              changeLine(index, {
                                quantity: Number(e.target.value),
                              })
                            }
                          />
                        </label>
                        <Amount
                          label="Ед. цена без ДДС (валута на фактурата)"
                          value={line.unitNetCents}
                          onChange={(n) =>
                            changeLine(index, { unitNetCents: n })
                          }
                        />
                        <Amount
                          label="Покупно ДДС (%)"
                          value={line.purchaseVatBps}
                          percent
                          onChange={(n) =>
                            changeLine(index, { purchaseVatBps: n })
                          }
                        />
                      </div>
                    </article>
                  ))}
                </div>
                <button
                  className="button button-light"
                  disabled={draft.lines.length >= 200}
                  onClick={() =>
                    change({ lines: [...draft.lines, blankLine()] })
                  }
                >
                  Добави ред
                </button>
              </fieldset>
              <section className="invoice-price-section">
                <h2>3. Себестойност и цена</h2>
                <p>
                  Параметрите са за една продаваема единица в поръчка. Нулевите
                  разходи трябва да се проверят; това са сценарии, а не оферта
                  от куриер или изчисление на данъчно задължение.
                </p>
                <div className="invoice-meta customer-form">
                  <label className="product-alert-toggle">
                    <input
                      type="checkbox"
                      checked={settings.vatRegistered}
                      onChange={(e) =>
                        setSettings((s) => ({
                          ...s,
                          vatRegistered: e.target.checked,
                        }))
                      }
                    />{" "}
                    Фирмата начислява ДДС
                  </label>
                  <Amount
                    label="Продажбено ДДС (%)"
                    value={settings.salesVatBps}
                    percent
                    onChange={(n) =>
                      setSettings((s) => ({ ...s, salesVatBps: n }))
                    }
                  />
                  <Amount
                    label="Опаковка / единица (EUR)"
                    value={settings.packagingCents}
                    onChange={(n) =>
                      setSettings((s) => ({ ...s, packagingCents: n }))
                    }
                  />
                  <Amount
                    label="Общи разходи / единица (EUR)"
                    value={settings.overheadCents}
                    onChange={(n) =>
                      setSettings((s) => ({ ...s, overheadCents: n }))
                    }
                  />
                  <Amount
                    label="Резерв за връщания / единица (EUR)"
                    value={settings.returnsReserveCents}
                    onChange={(n) =>
                      setSettings((s) => ({ ...s, returnsReserveCents: n }))
                    }
                  />
                  <Amount
                    label="Платежна такса (%)"
                    value={settings.paymentFeeBps}
                    percent
                    onChange={(n) =>
                      setSettings((s) => ({ ...s, paymentFeeBps: n }))
                    }
                  />
                  <Amount
                    label="Фиксирана платежна такса (EUR)"
                    value={settings.paymentFixedCents}
                    onChange={(n) =>
                      setSettings((s) => ({ ...s, paymentFixedCents: n }))
                    }
                  />
                  <Amount
                    label="Допускане за данък върху печалбата (%)"
                    value={settings.profitTaxBps}
                    percent
                    onChange={(n) =>
                      setSettings((s) => ({ ...s, profitTaxBps: n }))
                    }
                  />
                  <Amount
                    label="Целеви марж след този данък (%)"
                    value={settings.targetNetMarginBps}
                    percent
                    onChange={(n) =>
                      setSettings((s) => ({ ...s, targetNetMarginBps: n }))
                    }
                  />
                  <label>
                    Куриер
                    <select
                      value={settings.courier}
                      onChange={(e) =>
                        setSettings((s) => ({
                          ...s,
                          courier: e.target.value as "econt" | "speedy",
                        }))
                      }
                    >
                      <option value="econt">Еконт</option>
                      <option value="speedy">Спиди</option>
                    </select>
                  </label>
                  <Amount
                    label="Твой разход за куриер (EUR)"
                    value={settings.courierCostCents}
                    onChange={(n) =>
                      setSettings((s) => ({ ...s, courierCostCents: n }))
                    }
                  />
                </div>
                <button
                  className="button button-light"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await api("/api/admin/invoices", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(settings),
                      });
                      setMessage(
                        "Параметрите за следващи ценови предложения са запазени.",
                      );
                    })
                  }
                >
                  Запази ценовите параметри
                </button>
                <p className="note">
                  Прагът е за стойността на цялата количка след намаления. За
                  ценовия сценарий консервативно отнасяме целия куриерски разход
                  към една единица; при няколко артикула той се разпределя.
                  Правилото за безплатна доставка се задава отделно в
                  администрацията.
                </p>
                <Link className="text-link" href="/admin/settings">
                  Настрой прага за безплатна доставка →
                </Link>
                {!validation.success && (
                  <p className="note">
                    За изчисляване попълни коректно фактурата:{" "}
                    {validation.error.issues[0]?.message}
                  </p>
                )}
                {costs.map((cost, index) => {
                  const line = draft.lines[index];
                  let paid, free;
                  let issue = "";
                  try {
                    paid = priceScenario(cost.unitCents, settings, false);
                    free = priceScenario(cost.unitCents, settings, true);
                  } catch (e) {
                    issue = (e as Error).message;
                  }
                  const market = research[identity(line)];
                  const comparable =
                    market?.offers
                      .filter(
                        (o) =>
                          o.usableForComparison && identityMatches(line, o),
                      )
                      .map((o) => Math.round(o.price! * 100))
                      .sort((a, b) => a - b) ?? [];
                  const middle = Math.floor(comparable.length / 2);
                  const median = comparable.length
                    ? comparable.length % 2
                      ? comparable[middle]
                      : Math.round(
                          (comparable[middle - 1] + comparable[middle]) / 2,
                        )
                    : null;
                  const target = free?.suggestedGrossCents;
                  const proposal =
                    target && median !== null
                      ? Math.max(target, median - 1)
                      : target;
                  return (
                    <article className="price-proposal" key={line.sku}>
                      <h3>
                        {line.name} <small>{line.sku}</small>
                      </h3>
                      <p>
                        Себестойност / единица:{" "}
                        <strong>
                          {formatMoney(Math.ceil(cost.unitCents))}
                        </strong>
                      </p>
                      {issue && <p className="error">{issue}</p>}
                      {paid && free && (
                        <div className="price-scenarios">
                          <div>
                            <small>ДОСТАВКАТА Е ЗА КЛИЕНТА</small>
                            <strong>
                              {formatMoney(paid.suggestedGrossCents)}
                            </strong>
                            <p>
                              Праг без загуба:{" "}
                              {formatMoney(paid.breakEvenGrossCents)}
                              <br />
                              Печалба след зададения данък:{" "}
                              {formatMoney(paid.profitAfterTaxCents)}
                            </p>
                          </div>
                          <div>
                            <small>ТИ ПОЕМАШ ДОСТАВКАТА</small>
                            <strong>
                              {formatMoney(free.suggestedGrossCents)}
                            </strong>
                            <p>
                              Праг без загуба:{" "}
                              {formatMoney(free.breakEvenGrossCents)}
                              <br />
                              Печалба след зададения данък:{" "}
                              {formatMoney(free.profitAfterTaxCents)}
                            </p>
                          </div>
                        </div>
                      )}
                      <button
                        className="button button-light"
                        disabled={
                          busy ||
                          !ai ||
                          (!line.ean && !(line.brand && line.manufacturerCode))
                        }
                        onClick={() =>
                          run(async () => {
                            const result = await action({
                              action: "market",
                              line,
                            });
                            setResearch((r) => ({
                              ...r,
                              [identity(line)]: result,
                            }));
                            setMessage(
                              "Офертите са намерени. Провери източниците и съвпадението преди избор на цена.",
                            );
                          })
                        }
                      >
                        Сравни с магазини в България
                      </button>
                      {market && (
                        <div className="market-results">
                          <p>{market.summary}</p>
                          <p className="note">
                            Проверено:{" "}
                            {new Date(market.checkedAt).toLocaleString(
                              locale === "en" ? "en-GB" : "bg-BG",
                            )}{" "}
                            · ИИ резултат, изисква преглед.
                          </p>
                          {!market.offers.length && (
                            <p>Няма достатъчно подкрепени с източник оферти.</p>
                          )}
                          {market.offers.map((offer, i) => (
                            <article
                              className="market-offer"
                              key={`${offer.url}-${i}`}
                            >
                              <a
                                href={offer.url}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                {offer.shop} · {offer.title} ↗
                              </a>
                              <p>
                                {offer.price === null
                                  ? "Неизвестна цена"
                                  : `${offer.price} ${offer.currency}`}{" "}
                                ·{" "}
                                {offer.usableForComparison
                                  ? "Точно съвпадение по данните на ИИ"
                                  : "Не участва в ценовия ориентир"}
                              </p>
                              <p>{offer.evidence}</p>
                              <small>{offer.shippingNote}</small>
                            </article>
                          ))}
                          {median !== null && proposal && (
                            <p>
                              <strong>
                                Пазарен ориентир: {formatMoney(median)}.
                                Предложение с поета доставка:{" "}
                                {formatMoney(proposal)}.
                              </strong>{" "}
                              {target! > median
                                ? "Пазарната цена е под целта за марж — не намаляваме автоматично под нея."
                                : "Предложението е близо до пазарния ориентир и покрива зададения марж."}
                            </p>
                          )}
                        </div>
                      )}
                    </article>
                  );
                })}
              </section>
              <section className="benefits-control">
                <h2>4. Потвърди доставката в склада</h2>
                <p>
                  Добавяме бройките и стойността на придобиване в PostgreSQL.
                  Импортираните продукти остават в административния склад;
                  публикуването им в магазина изисква категории, снимки и
                  одобрени продажни цени.
                </p>
                <label className="product-alert-toggle">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    disabled={locked}
                    onChange={(e) => setConfirmed(e.target.checked)}
                  />{" "}
                  Проверих оригинала, идентичността, мерните единици,
                  количествата, отстъпките и ДДС.
                </label>
                <button
                  className="button"
                  disabled={locked || !confirmed || !validation.success}
                  onClick={() =>
                    run(async () => {
                      const result = await action({
                        action: "post",
                        invoice: { ...draft, confirmed: true },
                        pricingAssumptions: settings,
                      });
                      populate(await api(`/api/admin/invoices/${active.id}`));
                      await refresh();
                      setMessage(
                        result.alreadyPosted
                          ? "Фактурата вече е заприходена. Наличността не е добавена повторно."
                          : "Фактурата е заприходена в базата.",
                      );
                    })
                  }
                >
                  Заприходи в склада
                </button>
              </section>
            </section>
          )}
          <section className="invoice-stock" id="warehouse-stock">
            <h2>Склад от заприходени фактури</h2>
            <p className="note">
              Това са постоянни складови записи, отделни от демонстрационните
              продукти на витрината.
            </p>
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>SKU / Продукт</th>
                    <th>Налични</th>
                    <th>Резервирани</th>
                    <th>Стойност на придобиване</th>
                    <th>Галерия</th>
                  </tr>
                </thead>
                <tbody>
                  {stock.map((p) => (
                    <tr key={p.sku}>
                      <th scope="row">
                        {p.name}
                        <small>{p.sku}</small>
                      </th>
                      <td>{p.on_hand}</td>
                      <td>{p.reserved}</td>
                      <td>{formatMoney(Number(p.inventory_value_cents))}</td>
                      <td>
                        <a
                          href={`/admin/products?sku=${encodeURIComponent(p.sku)}`}
                        >
                          Снимки и видео →
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!stock.length && <p>Още няма заприходени стоки.</p>}
          </section>
        </section>
      }
    </Localize>
  );
}
