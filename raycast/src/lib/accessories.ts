import { List } from "@raycast/api";
import type { Accessory, PalItem } from "./pal";
import { iconFor, toColor } from "./icon";

type Valued = { value?: string; color?: string };

function split(field: Accessory[keyof Accessory]): Valued | undefined {
  if (field === undefined || field === null) return undefined;
  if (typeof field === "string") return { value: field };
  if (typeof field === "object" && "value" in field) return field as Valued;
  return undefined;
}

/**
 * pal accessories carry one of text/tag/date plus an optional icon and
 * tooltip; Raycast's ItemAccessory is the same shape as a union. Dates arrive
 * as strings over JSON and have to become real Dates for the relative
 * formatting ("now", "2d") to kick in.
 */
export function accessoriesFor(item: PalItem): List.Item.Accessory[] | undefined {
  if (!item.accessories?.length) return undefined;

  const result: List.Item.Accessory[] = [];

  for (const accessory of item.accessories) {
    const shared: Record<string, unknown> = {};
    if (accessory.icon) shared.icon = iconFor({ icon: accessory.icon, color: accessory.color });
    if (accessory.tooltip) shared.tooltip = accessory.tooltip;

    const tag = split(accessory.tag);
    const text = split(accessory.text);
    const date = split(accessory.date);

    if (tag?.value !== undefined) {
      const color = toColor(tag.color ?? accessory.color);
      result.push({
        ...shared,
        tag: color ? { value: tag.value, color } : tag.value,
      } as List.Item.Accessory);
      continue;
    }

    if (date?.value !== undefined) {
      const parsed = new Date(date.value);
      if (!Number.isNaN(parsed.valueOf())) {
        const color = toColor(date.color ?? accessory.color);
        result.push({
          ...shared,
          date: color ? { value: parsed, color } : parsed,
        } as List.Item.Accessory);
        continue;
      }
      // Not a real date - fall through and show it as plain text.
      result.push({ ...shared, text: date.value } as List.Item.Accessory);
      continue;
    }

    if (text?.value !== undefined) {
      const color = toColor(text.color ?? accessory.color);
      result.push({
        ...shared,
        text: color ? { value: text.value, color } : text.value,
      } as List.Item.Accessory);
      continue;
    }

    if (Object.keys(shared).length) result.push(shared as List.Item.Accessory);
  }

  return result.length ? result : undefined;
}

/** Item fields as PAL_* variables, matching what pal injects on pick. */
export function palEnvFor(item?: PalItem): Record<string, string> {
  if (!item) return {};
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(item)) {
    env[`PAL_${key.toUpperCase()}`] =
      typeof value === "string" ? value : JSON.stringify(value);
  }
  return env;
}
