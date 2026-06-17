import type { RequestHandler } from "./$types";
import { convertUnits } from "$lib/shape";
import { parseShapeParams, ShapeParamError } from "$lib/shapeParams";
import { meshToBinarySTL } from "$lib/stl";
import { buildHumpMold, buildSlumpMold } from "$lib/mold";

export const GET: RequestHandler = ({ url }) => {
  let p;
  try {
    p = parseShapeParams(url.searchParams);
  } catch (e) {
    if (e instanceof ShapeParamError) return new Response(e.message, { status: 400 });
    throw e;
  }

  const moldType = url.searchParams.get("moldType") ?? "hump";
  if (moldType !== "hump" && moldType !== "slump") {
    return new Response('Invalid "moldType": must be "hump" or "slump"', { status: 400 });
  }

  const moldParams = {
    sides: p.sides,
    height: p.height,
    bottomWidth: p.bottomWidth,
    topWidth: p.topWidth,
    clayThickness: p.clayThickness,
    units: p.units,
  };
  const mesh = moldType === "hump" ? buildHumpMold(moldParams) : buildSlumpMold(moldParams);
  const buffer = meshToBinarySTL(mesh, convertUnits(1, p.units, "mm"));
  const body = Uint8Array.from(buffer);

  const type = p.sides === "∞" ? "circle" : "prism-" + p.sides;
  const filename = `slabforge-${type}-${p.height}-${p.bottomWidth}-${p.topWidth}-${p.clayThickness}-${p.units}-${moldType}-mold.stl`;
  return new Response(body, {
    headers: {
      "Content-Type": "model/x.stl-binary",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
};
