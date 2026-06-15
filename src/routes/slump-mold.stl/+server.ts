import type { RequestHandler } from "./$types";
import makeShape, { convertUnits } from "$lib/shape";
import { parseShapeParams, ShapeParamError } from "$lib/shapeParams";
import { meshToBinarySTL } from "$lib/stl";

export const GET: RequestHandler = ({ url }) => {
  let p;
  try {
    p = parseShapeParams(url.searchParams);
  } catch (e) {
    if (e instanceof ShapeParamError) return new Response(e.message, { status: 400 });
    throw e;
  }

  const ct = p.clayThickness;
  const shape = makeShape(
    p.sides,
    p.height + ct,
    p.bottomWidth + ct,
    p.topWidth + ct,
    convertUnits(0.5, "cm", p.units),
    p.seamMode,
    p.units
  );
  const buffer = meshToBinarySTL(shape.calc3DGeometry(), convertUnits(1, p.units, "mm"));
  const body = Uint8Array.from(buffer);

  const type = p.sides === "∞" ? "circle" : "prism-" + p.sides;
  const filename = `slabforge-${type}-${p.height}-${p.bottomWidth}-${p.topWidth}-${p.clayThickness}-${p.units}-slump-mold.stl`;
  return new Response(body, {
    headers: {
      "Content-Type": "model/x.stl-binary",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
};
