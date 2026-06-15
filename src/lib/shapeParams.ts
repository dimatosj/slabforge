import type { Units } from "./shape";

export class ShapeParamError extends Error {}

export interface ShapeParams {
  sides: number | "∞";
  height: number;
  bottomWidth: number;
  topWidth: number;
  clayThickness: number;
  seamMode: "sides" | "base";
  units: Units;
  pageSize: string;
}

function positive(sp: URLSearchParams, key: string): number {
  const v = parseFloat(sp.get(key) ?? "");
  if (!Number.isFinite(v) || v <= 0) {
    throw new ShapeParamError(`Invalid or missing "${key}": must be a positive number`);
  }
  return v;
}

export function parseShapeParams(sp: URLSearchParams): ShapeParams {
  const sidesRaw = sp.get("sides");
  let sides: number | "∞";
  if (sidesRaw === "∞") {
    sides = "∞";
  } else {
    const n = Number(sidesRaw);
    if (!Number.isInteger(n) || n < 3 || n > 20) {
      throw new ShapeParamError(`Invalid "sides": must be "∞" or an integer between 3 and 20`);
    }
    sides = n;
  }

  const height = positive(sp, "height");
  const bottomWidth = positive(sp, "bottomWidth");
  const topWidth = positive(sp, "topWidth");
  const clayThickness = positive(sp, "clayThickness");

  const seamMode = sp.get("seamMode") ?? "sides";
  if (seamMode !== "sides" && seamMode !== "base") {
    throw new ShapeParamError(`Invalid "seamMode": must be "sides" or "base"`);
  }

  const units = sp.get("units") ?? "in";
  if (units !== "in" && units !== "cm") {
    throw new ShapeParamError(`Invalid "units": must be "in" or "cm"`);
  }

  const pageSize = sp.get("pageSize") ?? "letter";
  if (pageSize !== "letter" && pageSize !== "auto") {
    throw new ShapeParamError(`Invalid "pageSize": must be "letter" or "auto"`);
  }

  return { sides, height, bottomWidth, topWidth, clayThickness, seamMode, units, pageSize };
}
