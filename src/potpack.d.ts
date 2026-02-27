declare module 'potpack' {
    export interface PotpackBox {
        w: number;
        h: number;
        x?: number;
        y?: number;
    }

    export interface PotpackResult {
        w: number;         // resulting width
        h: number;         // resulting height
        fill: number;      // fill ratio
    }

    export default function potpack(boxes: PotpackBox[]): PotpackResult;
}
