"use client";
import Localize from "./localize";

import {
  notificationServices,
  type NotificationPreferences,
} from "../lib/customer-preferences";
export default function NotificationChoices({
  value,
  onChange,
  disabled = false,
}: {
  value: NotificationPreferences;
  onChange: (value: NotificationPreferences) => void;
  disabled?: boolean;
}) {
  return (
    <Localize>
      {
        <div className="notification-choices">
          {notificationServices.map((service) => (
            <label
              className={`notification-choice ${value[service.key] ? "is-selected" : ""}`}
              key={service.key}
            >
              <input
                type="checkbox"
                checked={value[service.key]}
                disabled={disabled}
                onChange={(event) =>
                  onChange({ ...value, [service.key]: event.target.checked })
                }
              />
              <span>
                <strong>{service.title}</strong>
                <small>{service.description}</small>
              </span>
            </label>
          ))}
        </div>
      }
    </Localize>
  );
}
