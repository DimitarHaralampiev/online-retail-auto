"use client";
import {
  Children,
  cloneElement,
  isValidElement,
  type ReactNode,
  type ReactElement,
} from "react";
import { useLocale } from "./locale-provider";
import { translate } from "../lib/i18n/translate";
import type { Locale } from "../lib/i18n/locale";
// Translate display text only. Inputs, identifiers, URLs and business values stay intact.
export function localizeTree(node: ReactNode, locale: Locale): ReactNode {
  if (typeof node === "string") return translate(node, locale);
  if (Array.isArray(node))
    return Children.map(node, (child) => localizeTree(child, locale));
  if (!isValidElement(node)) return node;
  const element = node as ReactElement<Record<string, unknown>>;
  const props = element.props;
  const updates: Record<string, unknown> = {};
  for (const key of ["placeholder", "aria-label", "alt", "title", "label"])
    if (typeof props[key] === "string")
      updates[key] = translate(props[key] as string, locale);
  if (
    element.type === "option" &&
    props.value === undefined &&
    typeof props.children === "string"
  )
    updates.value = props.children;
  if (props.children !== undefined)
    updates.children = Children.map(props.children as ReactNode, (child) =>
      localizeTree(child, locale),
    );
  return cloneElement(element, updates);
}
export default function Localize({ children }: { children: ReactNode }) {
  const { locale } = useLocale();
  return localizeTree(children, locale);
}
