import Link from "next/link";
import { database } from "../../../lib/accounts";
import { currentAdmin } from "../../../lib/admin-product-http";
import { referenceTree } from "../../../lib/admin-vehicles";
import { requestLocale } from "../../../lib/i18n/server";
import { VEHICLE_IMPORT_COLUMNS } from "../../../lib/vehicle-import";
import { FITMENT_IMPORT_COLUMNS } from "../../../lib/fitment-import";
import { FUELS } from "../../../lib/vehicles";
import SiteHeader from "../../../components/site-header";
import SiteFooter from "../../../components/site-footer";
import CsvImport from "../../../components/csv-import";
import VehicleForm from "../../../components/vehicle-form";
import VehicleVisibility from "../../../components/vehicle-visibility";

export default async function AdminVehiclesPage() {
  const en = (await requestLocale()) === "en";
  const text = (bg: string, english: string) => (en ? english : bg);
  const admin = await currentAdmin();
  const tree = admin ? await referenceTree(database()) : null;
  const status = (active: boolean) => (
    <span
      className={`admin-product-status ${active ? "published" : "archived"}`}
    >
      {active ? text("Видима", "Shown") : text("Скрита", "Hidden")}
    </span>
  );
  return (
    <>
      <SiteHeader />
      <main id="main-content" className="site-width inventory-page">
        <section className="page-intro">
          <Link href="/admin">← {text("Администрация", "Administration")}</Link>
          <p className="eyebrow">{text("СЪВМЕСТИМОСТ", "FITMENT")}</p>
          <h1>{text("Автомобили", "Vehicles")}</h1>
          <p>
            {text(
              "Справочник на марки, модели, поколения и двигатели. Зарежда се само от проверен източник (каталог на производителя или лицензиран каталог) — никога по предположение.",
              "Reference of makes, models, generations and engines. Load it only from a verified source (manufacturer or licensed catalogue) — never from guesses.",
            )}
          </p>
        </section>
        {!tree ? (
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
            <section className="checkout-panel">
              <h2>{text("Импорт от CSV", "CSV import")}</h2>
              <p>
                <code>{VEHICLE_IMPORT_COLUMNS.join(";")}</code>
              </p>
              <ul>
                <li>
                  {text(
                    "Един ред е един двигател на поколение (или поколение без двигатели). Задължителни: make, model, generation, year_from.",
                    "One row is one engine of a generation (or a generation without engines). Required: make, model, generation, year_from.",
                  )}
                </li>
                <li>
                  {text(
                    "Редът е пълният запис: празна клетка изтрива стойността (празно year_to значи „все още се произвежда“).",
                    "A row is the full record: an empty cell clears the value (empty year_to means “still in production”).",
                  )}
                </li>
                <li>
                  {text(
                    "Адресите (make_slug, model_slug) се изчисляват от латинските имена; задай ги при имена на кирилица. fuel е едно от: ",
                    "Addresses (make_slug, model_slug) are derived from Latin names; set them for Cyrillic names. fuel is one of: ",
                  )}
                  {FUELS.join(", ")}.
                </li>
                <li>
                  {text(
                    "Нищо не се изтрива: за грешен запис използвай „Скрий“. Единични записи се добавят и редактират в „Справочник“ по-долу.",
                    "Nothing is deleted: use “Hide” for a wrong entry. Add and edit single entries under “Reference” below.",
                  )}
                </li>
              </ul>
            </section>
            <CsvImport
              endpoint="/api/admin/vehicles/imports"
              doneHref="/admin/vehicles"
              doneLabel={["Обнови справочника →", "Refresh the reference →"]}
              keyLabel={["Автомобил", "Vehicle"]}
            />
            <section className="checkout-panel">
              <h2>{text("Импорт на съвместимост", "Fitment import")}</h2>
              <p>
                <code>{FITMENT_IMPORT_COLUMNS.join(";")}</code>
              </p>
              <ul>
                <li>
                  {text(
                    "Един ред е една проверена съвместимост продукт–автомобил. Автомобилът трябва вече да е в справочника; source (източникът на проверката) е задължителен.",
                    "One row is one verified product–vehicle fitment. The vehicle must already be in the reference; source (where it was verified) is required.",
                  )}
                </li>
                <li>
                  {text(
                    "Празен engine значи всички двигатели на поколението; year_from/year_to ограничават годините в поколението. remove = yes премахва съвместимостта.",
                    "An empty engine means every engine of the generation; year_from/year_to limit the years within it. remove = yes deletes the fitment.",
                  )}
                </li>
              </ul>
            </section>
            <CsvImport
              endpoint="/api/admin/vehicles/fitment-imports"
              doneHref="/admin/vehicles"
              doneLabel={["Обнови справочника →", "Refresh the reference →"]}
              keyLabel={["Съвместимост", "Fitment"]}
            />
            <section className="checkout-panel">
              <h2>{text("Справочник", "Reference")}</h2>
              <div className="admin-product-actions">
                <VehicleForm
                  kind="make"
                  label={text("Нова марка", "New make")}
                  className="button"
                />
              </div>
              {tree.length === 0 ? (
                <p>
                  {text(
                    "Все още няма въведени автомобили.",
                    "No vehicles have been entered yet.",
                  )}
                </p>
              ) : (
                <div className="table-wrapper">
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">
                          {text("Марка / модел", "Make / model")}
                        </th>
                        <th scope="col">{text("Адрес", "Address")}</th>
                        <th scope="col">{text("Поколения", "Generations")}</th>
                        <th scope="col">{text("Двигатели", "Engines")}</th>
                        <th scope="col">{text("Съвместимости", "Fitments")}</th>
                        <th scope="col">{text("Статус", "Status")}</th>
                        <th scope="col">
                          <span className="visually-hidden">
                            {text("Действия", "Actions")}
                          </span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {tree.flatMap((make) => [
                        <tr key={make.id}>
                          <th scope="row">{make.name}</th>
                          <td>
                            <code>{make.slug}</code>
                          </td>
                          <td colSpan={3}>
                            {make.models.length} {text("модела", "models")}
                          </td>
                          <td>{status(make.active)}</td>
                          <td className="admin-row-actions">
                            <VehicleForm
                              kind="model"
                              parentId={make.id}
                              label={text("Нов модел", "New model")}
                              about={make.name}
                            />
                            <VehicleForm
                              kind="make"
                              label={text("Редактирай", "Edit")}
                              about={make.name}
                              entry={make}
                            />
                            <VehicleVisibility
                              kind="make"
                              id={make.id}
                              name={make.name}
                              active={make.active}
                            />
                          </td>
                        </tr>,
                        ...make.models.map((model) => (
                          <tr key={model.id}>
                            <td>— {model.name}</td>
                            <td>
                              <code>{model.slug}</code>
                            </td>
                            <td>{model.generations}</td>
                            <td>{model.engines}</td>
                            <td>{model.fitments}</td>
                            <td>{status(model.active)}</td>
                            <td className="admin-row-actions">
                              <Link
                                className="text-link"
                                href={`/admin/vehicles/models/${model.id}`}
                                aria-label={`${text("Поколения", "Generations")}: ${make.name} ${model.name}`}
                              >
                                {text("Поколения", "Generations")}
                              </Link>
                              <VehicleForm
                                kind="model"
                                label={text("Редактирай", "Edit")}
                                about={`${make.name} ${model.name}`}
                                entry={model}
                              />
                              <VehicleVisibility
                                kind="model"
                                id={model.id}
                                name={`${make.name} ${model.name}`}
                                active={model.active}
                              />
                            </td>
                          </tr>
                        )),
                      ])}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
