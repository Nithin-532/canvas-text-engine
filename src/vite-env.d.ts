/// <reference types="vite/client" />

declare module '*.wasm' {
    const value: string;
    export default value;
}

declare module 'harfbuzzjs' {
    export interface HBBlob {
        destroy(): void;
    }
    export interface HBFace {
        destroy(): void;
        reference_table(tag: string): HBBlob;
        getAxisInfos(): Array<{
            tag: string;
            name: string;
            min: number;
            default: number;
            max: number;
        }>;
        collectUnicodes(): Set<number>;
    }
    export interface HBFont {
        destroy(): void;
        setScale(xScale: number, yScale: number): void;
        setVariations(variations: Record<string, number>): void;
        glyphToPath(glyphId: number): string;
        glyphToJson(glyphId: number): Array<{
            type: string;
            values: number[];
        }>;
        glyphName(glyphId: number): string;
    }
    export interface HBBuffer {
        destroy(): void;
        addText(text: string): void;
        guessSegmentProperties(): void;
        setDirection(direction: string): void;
        setScript(script: string): void;
        setLanguage(language: string): void;
        setClusterLevel(level: number): void;
        json(): Array<{
            g: number;       // glyph ID
            cl: number;      // cluster index
            ax: number;      // x advance
            ay: number;      // y advance
            dx: number;      // x offset
            dy: number;      // y offset
            flags: number;
        }>;
    }
    export interface HBInstance {
        createBlob(data: ArrayBuffer): HBBlob;
        createFace(blob: HBBlob, index: number): HBFace;
        createFont(face: HBFace): HBFont;
        createBuffer(): HBBuffer;
        shape(font: HBFont, buffer: HBBuffer, features?: string): void;
    }
}

declare module 'harfbuzzjs/hbjs.js' {
    import { HBInstance } from 'harfbuzzjs';
    function hbjs(instance: WebAssembly.WebAssemblyInstantiatedSource | any): HBInstance;
    export default hbjs;
}

declare module 'harfbuzzjs/hb.js' {
    export default function loadHarfbuzz(options?: { locateFile?: (path: string) => string }): Promise<any>;
}
