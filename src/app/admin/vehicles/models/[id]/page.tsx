// Generations and engines of one model (#91).
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { database } from "../../../../../lib/accounts";
import { currentAdmin } from "../../../../../lib/admin-product-http";
import { referenceModel } from "../../../../../lib/admin-vehicles";
import { requestLocale } from "../../../../../lib/i18n/server";
import { FUEL_LABELS } from "../../../../../lib/vehicle-fuels";
import SiteHeader from "../../../../../components/site-header";
import SiteFooter from "../../../../../components/site-footer";
import VehicleForm from "../../../../../components/vehicle-form";
import VehicleVisibility from "../../../../../components/vehicle-visibility";

export default async function AdminVehicleModelPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const en = (await requestLocale()) === "en";
  const text = (bg: string, english: string) => (en ? english : bg);
  const admin = await currentAdmin();
  const id = z.uuid().safeParse((await params).id);
  const model =
    admin && id.success ? await referenceModel(database(), id.data) : null;
  if (admin && !model) notFound();
  const status = (active: boolean) => (
    <span
      className={`admin-product-status ${active ? "published" : "archived"}`}
    >
      {active ? text("Видимо", "Shown") : text("Скрито", "Hidden")}
    </span>
  );
  return (
    <>
      <SiteHeader />
      <main id="main-content" className="site-width inventory-page">
        <section className="page-intro">
          <Link href="/admin/vehicles">← {text("Автомобили", "Vehicles")}</Link>
          <p className="eyebrow">{text("СЪВМЕСТИМОСТ", "FITMENT")}</p>
          <h1>
            {model
              ? `${model.make} ${model.name}`
              : text("Автомобили", "Vehicles")}
          </h1>
          <p>
            {text(
              "Поколения и двигатели на модела. Въвеждай само проверени данни (каталог на производителя или лицензиран каталог). Скритите не се предлагат на клиентите.",
              "The model's generations and engines. Enter only verified data (manufacturer or licensed catalogue). Hidden ones are not offered to shoppers.",
            )}
          </p>
        </section>
        {!model ? (
          <p>
            <Link href="/account">
              {text(
                "Влез с администраторски профил.",
                "Sign in with an administrator account.",
              )}
            </Link>
          </p>
        ) : (
          <>
            <div className="admin-product-actions">
              <VehicleForm
                kind="generation"
                parentId={model.id}
                label={text("Ново поколение", "New generation")}
                className="button"
              />
            </div>
            {model.generations.length === 0 && (
              <p>{text("Още няма поколения.", "No generations yet.")}</p>
            )}
            {model.generations.map((generation) => (
              <section key={generation.id} className="checkout-panel">
                <h2>
                  {generation.name} ({generation.yearFrom}–
                  {generation.yearTo ?? text("днес", "today")})
                </h2>
                <div className="admin-entry-actions">
                  {status(generation.active)}
                  <VehicleForm
                    kind="engine"
                    parentId={generation.id}
                    label={text("Нов двигател", "New engine")}
                    about={generation.name}
                  />
                  <VehicleForm
                    kind="generation"
                    label={text("Редактирай", "Edit")}
                    about={generation.name}
                    entry={generation}
                  />
                  <VehicleVisibility
                    kind="generation"
                    id={generation.id}
                    name={generation.name}
                    active={generation.active}
                  />
                </div>
                <p>
                  {text(
                    "Съвместимости за всички двигатели: ",
                    "Fitments for every engine: ",
                  )}
                  {generation.fitments}
                </p>
                {generation.engines.length > 0 && (
                  <div className="table-wrapper">
                    <table>
                      <thead>
                        <tr>
                          <th scope="col">{text("Двигател", "Engine")}</th>
                          <th scope="col">{text("Гориво", "Fuel")}</th>
                          <th scope="col">{text("Обем", "Displacement")}</th>
                          <th scope="col">{text("Мощност", "Power")}</th>
                          <th scope="col">{text("Код", "Code")}</th>
                          <th scope="col">
                            {text("Съвместимости", "Fitments")}
                          </th>
                          <th scope="col">{text("Статус", "Status")}</th>
                          <th scope="col">
                            <span className="visually-hidden">
                              {text("Действия", "Actions")}
                            </span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {generation.engines.map((engine) => (
                          <tr key={engine.id}>
                            <th scope="row">{engine.name}</th>
                            <td>{text(...FUEL_LABELS[engine.fuel])}</td>
                            <td>
                              {engine.displacementCc
                                ? `${engine.displacementCc} cc`
                                : "—"}
                            </td>
                            <td>
                              {engine.powerKw ? `${engine.powerKw} kW` : "—"}
                            </td>
                            <td>{engine.engineCode || "—"}</td>
                            <td>{engine.fitments}</td>
                            <td>{status(engine.active)}</td>
                            <td className="admin-row-actions">
                              <VehicleForm
                                kind="engine"
                                label={text("Редактирай", "Edit")}
                                about={`${generation.name} ${engine.name}`}
                                entry={engine}
                              />
                              <VehicleVisibility
                                kind="engine"
                                id={engine.id}
                                name={`${generation.name} ${engine.name}`}
                                active={engine.active}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            ))}
          </>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
