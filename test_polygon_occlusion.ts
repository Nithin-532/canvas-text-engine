import { intersectionsToIntervals, polygonToSegments } from "./src/geometry/Polygon.ts";
import { ScanlineEngine, WrapPolygon } from "./src/geometry/ScanlineEngine.ts";
import { makeEllipsePolygon, expandPolygon } from "./src/geometry/Polygon.ts";

const engine = new ScanlineEngine();
const triangle: WrapPolygon = {
    polygon: { points: [{ x: 60, y: 800 }, { x: 400, y: 800 }, { x: 60, y: 500 }] },
    padding: 25,
};

const intervals700 = engine.getRectIntervals(60, 160, [triangle], 700, 20);
console.log("Column 1 (x: 60..220) at Y=700:", intervals700);
const intervals750 = engine.getRectIntervals(60, 160, [triangle], 750, 20);
console.log("Column 1 (x: 60..220) at Y=750:", intervals750);
