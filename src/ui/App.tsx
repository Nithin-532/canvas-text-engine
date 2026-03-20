/* ═══════════════════════════════════════════════════════════════
   App — React Application Shell
   
   Premium dark-themed UI with sidebar controls and canvas area
   for the text layout engine.
   ═══════════════════════════════════════════════════════════════ */

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { LayoutEngine } from '../layout/LayoutEngine';
import { CanvasRenderer } from '../renderer/CanvasRenderer';
import { WebGLRenderer } from '../renderer/WebGLRenderer';
import { NullGPURenderer } from '../renderer/NullGPURenderer';
import type { IGPURenderer } from '../renderer/GPURendererInterface';
import { MSDFAtlasGenerator } from '../renderer/MSDFAtlasGenerator';
import type { MSDFAtlas } from '@zappar/msdf-generator';
import type { ComposerType, TextAlignment, WrapObject } from '../types';
import { DEFAULT_ENGINE_CONFIG } from '../types';
import { makeEllipsePolygon } from '../geometry/Polygon';
import { Table, getTablePresetStyle } from '../core/Table';
import type { TablePreset } from '../core/Table';
import type { RowHeightMode } from '../types';
import { parseLSXMLJson } from '../idml/JSONParser';
import type { IDMLGraphicLine } from '../idml/JSONParser';

const SAMPLE_TEXT = `Typography is the art and technique of arranging type to make written language legible, readable, and appealing when displayed. The arrangement of type involves selecting typefaces, point sizes, line lengths, line-spacing (leading), and letter-spacing (tracking), as well as adjusting the space between pairs of letters (kerning).

The term typography is also applied to the style, arrangement, and appearance of the letters, numbers, and symbols created by the process. Type design is a closely related craft, sometimes considered part of typography; most typographers do not design typefaces, and some type designers do not consider themselves typographers.

Typography also may be used as an ornamental and decorative device, unrelated to the communication of information. Typography is the work of typesetters (also known as compositors), typographers, graphic designers, art directors, manga artists, comic book artists, and, now, anyone who arranges words, letters, numbers, and symbols for publication, display, or distribution.

Until the Digital Age, typography was a specialized occupation. Digitization opened up typography to new generations of previously unrelated designers and lay users. As the capability to create typography has become ubiquitous, the application of principles and best practices developed over generations of skilled workers and professionals has diminished.

In contemporary use, the practice and study of typography are very broad, covering all aspects of letter design and application, both mechanical (typesetting, type design, and typefaces) and manual (handwriting and calligraphy). Typography is applied to the style, arrangement, and appearance of the letters, numbers, and symbols created by the process.

Good typography is measured by how well it spells out the message it is trying to convey. In this digital age, attention spans are short and information is abundant. If your text is difficult to read because of poor typographic choices, your audience will move on. Contrast, hierarchy, grid systems, and white space are your tools. Use them wisely to guide the reader's eye and create a harmonious composition.

A key element of typography is choosing the right typeface. Serif fonts, with their small decorative strokes, often convey tradition, reliability, and formality. Sans-serif fonts, lacking these strokes, are seen as modern, clean, and approachable. The choice depends entirely on the context and the audience. Mixing typefaces can create visual interest but should be done with care to avoid a cluttered or confusing appearance.

Remember that typography is not just about legibility; it is also about conveying emotion and tone. A delicate script font will evoke a very different feeling than a heavy, geometric display font. The best typographers understand this and use type as a powerful tool for communication and expression.`;

// ── Polygon tool types ──────────────────────────────────────────
interface ManagedPolygon {
    id: string;
    label: string;
    points: { x: number; y: number }[];
    padding: number;
    enabled: boolean;
}

let _nextPolyId = 1;
function newPolyId() { return `poly-${_nextPolyId++}`; }

const SNAP_RADIUS = 12; // px, distance to first vertex that closes polygon

export function App() {
    const uiCanvasRef = useRef<HTMLCanvasElement>(null);

    const engineRef = useRef<LayoutEngine | null>(null);
    const uiRendererRef = useRef<CanvasRenderer | null>(null);
    const gpuRendererRef = useRef<IGPURenderer | null>(null);
    const msdfGenRef = useRef<MSDFAtlasGenerator | null>(null);
    const atlasRef = useRef<MSDFAtlas | null>(null);
    const boldAtlasRef = useRef<MSDFAtlas | null>(null);
    const robotoTTFRef = useRef<ArrayBuffer | null>(null);
    const robotoBoldTTFRef = useRef<ArrayBuffer | null>(null);
    const baseCharsetRef = useRef<string>('');
    /** True when GPU acceleration is unavailable and Canvas 2D handles text rendering */
    const canvas2DTextRef = useRef(false);
    const [gpuBackend, setGpuBackend] = useState<'webgl' | 'canvas2d'>('webgl');

    const [status, setStatus] = useState<string>('Initializing...');
    const [statusDot, setStatusDot] = useState<'loading' | 'ok' | 'error'>('loading');
    const [layoutResult, setLayoutResult] = useState<import('../types').LayoutResult | null>(null);
    const [selection, setSelection] = useState<[number, number] | null>(null);
    const [activeStory, _setActiveStory] = useState<import('../core/Story').Story | null>(null);
    const activeStoryRef = useRef<import('../core/Story').Story | null>(null);
    const setActiveStory = useCallback((s: import('../core/Story').Story | null) => {
        activeStoryRef.current = s;
        _setActiveStory(s);
    }, []);
    const [isDragging, setIsDragging] = useState(false);

    // ── Dynamic paper dimensions (updated when loading IDML/JSON) ──
    const [paperWidth, setPaperWidth] = useState(DEFAULT_ENGINE_CONFIG.paperWidth);
    const [paperHeight, setPaperHeight] = useState(DEFAULT_ENGINE_CONFIG.paperHeight);
    const [isLoadingJSON, setIsLoadingJSON] = useState(false);
    const [isJSONMode, setIsJSONMode] = useState(false);
    /** Graphic lines (rules/borders) from IDML or JSON — rendered as canvas overlays */
    const graphicLinesRef = useRef<IDMLGraphicLine[]>([]);

    // ── Zoom / Pan state ────────────────────────────────────────
    const [zoom, setZoom] = useState(1.0);
    const [panX, setPanX] = useState(0);
    const [panY, setPanY] = useState(0);
    const [isPanning, setIsPanning] = useState(false);
    const panStartRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

    // ── Typography/Layout Controls ──────────────────────────────
    const [columns, setColumns] = useState(6);
    const [fontSize, setFontSize] = useState(14);
    const [leading, setLeading] = useState(1.4);
    const [fontWeight, setFontWeight] = useState<number>(400);
    const [fontStyle, setFontStyle] = useState<'normal' | 'italic'>('normal');
    const [color, setColor] = useState('#e8e8f0');
    const [tracking, setTracking] = useState(0);
    const [columnGap, setColumnGap] = useState(20);
    const [composer, setComposer] = useState<ComposerType>('paragraph');
    const [alignment, setAlignment] = useState<TextAlignment>('left');
    const [showColumns, setShowColumns] = useState(true);
    const [showBaselines, setShowBaselines] = useState(false);
    const [tolerance, setTolerance] = useState(2);
    const [opticalMargins, setOpticalMargins] = useState(false);
    const [hzProgramEnabled, setHzProgramEnabled] = useState(false);

    // ── Table Controls ──────────────────────────────────────────
    const [tableRows, setTableRows] = useState(3);
    const [tableCols, setTableCols] = useState(3);
    const [tablePreset, setTablePreset] = useState<TablePreset>('headerStriped');
    const [tableRowHeightMode, setTableRowHeightMode] = useState<RowHeightMode>('atLeast');
    const [tableCellPadding, setTableCellPadding] = useState(5);
    const [activeTableRef, setActiveTableRef] = useState<Table | null>(null);

    // ── Polygon / Wrap state ────────────────────────────────────
    const [polygons, setPolygons] = useState<ManagedPolygon[]>([
        {
            id: 'poly-initial-1',
            label: 'Center Circle',
            points: makeEllipsePolygon(600, 400, 200, 200).points,
            padding: 15,
            enabled: true,
        },
        {
            id: 'poly-initial-2',
            label: 'Bottom Left Triangle',
            points: [{ x: 60, y: 800 }, { x: 400, y: 800 }, { x: 60, y: 500 }],
            padding: 25,
            enabled: true,
        }
    ]);
    const [drawMode, setDrawMode] = useState(false);
    const [drawPoints, setDrawPoints] = useState<{ x: number; y: number }[]>([]);
    const [cursorPt, setCursorPt] = useState<{ x: number; y: number } | null>(null);

    // Active wrap objects derived from polygons list
    const activeWrapObjects = useMemo<WrapObject[]>(() =>
        polygons
            .filter(p => p.enabled)
            .map(p => ({
                id: p.id,
                polygon: p.points,
                padding: p.padding,
                wrapMode: 'around' as const,
            })),
        [polygons]
    );

    // ── Helpers to read canvas-relative coords (zoom/pan aware) ─
    const canvasPoint = useCallback((clientX: number, clientY: number) => {
        const rect = uiCanvasRef.current?.getBoundingClientRect();
        if (!rect) return null;
        // The canvas inside a CSS-transformed container:
        // rect already reflects the zoomed size, so dividing by zoom gives layout coords
        const x = (clientX - rect.left) / zoom;
        const y = (clientY - rect.top) / zoom;
        return { x, y };
    }, [zoom]);

    // ── Recompose + render ──────────────────────────────────────
    // Keep zoom in a ref so recompose doesn't depend on it (zoom is visual-only)
    const zoomRef = useRef(zoom);
    zoomRef.current = zoom;
    const pendingRecomposeRef = useRef<number | null>(null);

    const recompose = useCallback((wraps?: WrapObject[]) => {
        const engine = engineRef.current;
        const uiRenderer = uiRendererRef.current;
        const glRenderer = gpuRendererRef.current;
        const currentZoom = zoomRef.current;

        if (!engine || !uiRenderer || !glRenderer || engine.status.state !== 'ready') return;

        // In JSON mode: keep existing frames and use no polygon wraps
        const wrapObjects = isJSONMode ? [] : (wraps ?? activeWrapObjects);

        if (!isJSONMode) {
            engine.updateConfig({
                frames: [{
                    ...DEFAULT_ENGINE_CONFIG.frames[0]!,
                    columns,
                    columnGap,
                }],
                wrapObjects,
            });
        }

        // When WebGL is unavailable Canvas 2D renders text; otherwise WebGL does it
        uiRenderer.updateConfig({ showColumns, showBaselines, drawText: canvas2DTextRef.current });

        const result = engine.compose();
        setLayoutResult(result);

        // Always render text via WebGL MSDF (fast GPU path)
        glRenderer.setTransform(currentZoom, 0, 0);
        glRenderer.render(result, atlasRef.current);

        // Render UI overlays on top layer (cursor, frames, selection, etc.)
        uiRenderer.render(result, engine.frameManager.allFrames, selection, wrapObjects, glRenderer.getCanvas(), currentZoom, activeStoryRef.current ?? engine.story);
        // Draw graphic lines (rules, borders) from IDML/JSON on top of text
        if (graphicLinesRef.current.length > 0) {
            uiRenderer.drawGraphicLines(graphicLinesRef.current);
        }

        setStatus(`Ready — ${result.lineCount} lines in ${result.composeTimeMs.toFixed(1)}ms`);
        setStatusDot('ok');
        return result;
    }, [columns, columnGap, showColumns, showBaselines, selection, activeWrapObjects, activeStory]);

    /** Deferred recompose — coalesces rapid calls (e.g. typing, held Backspace)
     *  into a single layout pass per animation frame. */
    const recomposeDeferred = useCallback(() => {
        if (pendingRecomposeRef.current !== null) return; // already scheduled
        pendingRecomposeRef.current = requestAnimationFrame(() => {
            pendingRecomposeRef.current = null;
            recompose();
        });
    }, [recompose]);

    // Re-render (without recomposing layout) when zoom changes
    useEffect(() => {
        const glRenderer = gpuRendererRef.current;
        const uiRenderer = uiRendererRef.current;
        const engine = engineRef.current;
        if (!glRenderer || !uiRenderer || !engine || !layoutResult) return;

        const wraps = isJSONMode ? [] : activeWrapObjects;

        // Always use WebGL for text rendering
        glRenderer.setTransform(zoom, 0, 0);
        glRenderer.render(layoutResult, atlasRef.current);
        uiRenderer.render(
            layoutResult,
            engine.frameManager.allFrames,
            selection,
            wraps,
            glRenderer.getCanvas(),
            zoom,
            activeStoryRef.current ?? engine.story
        );
        if (graphicLinesRef.current.length > 0) {
            uiRenderer.drawGraphicLines(graphicLinesRef.current);
        }
    }, [zoom, layoutResult, selection, activeWrapObjects, isJSONMode]);


    const updateStyle = useCallback((type: 'char' | 'para', partialStyle: any) => {
        const engine = engineRef.current;
        if (!engine) return;
        const story = activeStory ?? engine.story;
        const targetStart = selection && selection[0] !== selection[1] ? Math.min(selection[0], selection[1]) : 0;
        const targetEnd = selection && selection[0] !== selection[1] ? Math.max(selection[0], selection[1]) : story.length;

        if (type === 'char') {
            story.applyCharacterStyle(targetStart, targetEnd - targetStart, partialStyle);
        } else {
            story.applyParagraphStyle(targetStart, targetEnd - targetStart, partialStyle);
        }
        recompose();
    }, [selection, recompose, activeStory]);

    // ── Polygon management ──────────────────────────────────────
    const addDemoEllipse = useCallback(() => {
        const frame = DEFAULT_ENGINE_CONFIG.frames[0]!;
        const colWidth = (frame.width - frame.columnGap * (frame.columns - 1)) / frame.columns;
        const cx = frame.x + colWidth / 2;
        const cy = frame.y + frame.height / 2;
        const pts = makeEllipsePolygon(cx, cy, colWidth * 0.35, 55, 24).points;
        setPolygons(prev => [...prev, {
            id: newPolyId(),
            label: 'Ellipse (demo)',
            points: pts,
            padding: 6,
            enabled: true,
        }]);
    }, []);

    const finishPolygon = useCallback((pts: { x: number; y: number }[]) => {
        if (pts.length < 3) return;
        setPolygons(prev => [...prev, {
            id: newPolyId(),
            label: `Polygon ${prev.length + 1}`,
            points: pts,
            padding: 6,
            enabled: true,
        }]);
        setDrawPoints([]);
        setCursorPt(null);
        setDrawMode(false);
    }, []);

    const cancelDraw = useCallback(() => {
        setDrawPoints([]);
        setCursorPt(null);
        setDrawMode(false);
    }, []);

    const deletePolygon = useCallback((id: string) => {
        setPolygons(prev => prev.filter(p => p.id !== id));
    }, []);

    const togglePolygon = useCallback((id: string) => {
        setPolygons(prev => prev.map(p => p.id === id ? { ...p, enabled: !p.enabled } : p));
    }, []);

    const updatePadding = useCallback((id: string, padding: number) => {
        setPolygons(prev => prev.map(p => p.id === id ? { ...p, padding } : p));
    }, []);

    // ── Object Insertion ────────────────────────────────────────
    const insertTable = useCallback(() => {
        if (!engineRef.current || !selection) return;
        const offset = Math.min(selection[0], selection[1]);

        // InDesign default: Table spans the width of the active column
        const frame = engineRef.current.frameManager.allFrames[0];
        let tableWidth = 400;
        if (frame) {
            tableWidth = (frame.width - frame.columnGap * (frame.columns - 1)) / frame.columns;
        }

        const presetStyle = getTablePresetStyle(tablePreset);
        const table = new Table({
            id: `table-${Date.now()}`,
            rows: tableRows,
            cols: tableCols,
            width: tableWidth,
            rowHeightMode: tableRowHeightMode,
            minRowHeight: 28,
            tableStyle: presetStyle,
            cellStyle: {
                paddingTop: tableCellPadding,
                paddingRight: tableCellPadding + 2,
                paddingBottom: tableCellPadding,
                paddingLeft: tableCellPadding + 2,
            },
        });

        // Add header text if preset has headers
        if (presetStyle.headerRows && presetStyle.headerRows > 0) {
            for (let c = 0; c < tableCols; c++) {
                const hCell = table.getCell(0, c);
                if (hCell) {
                    const headerText = `Header ${c + 1}`;
                    hCell.story.insert(0, headerText);
                    hCell.story.applyCharacterStyle(0, headerText.length, {
                        fontSize: 12, fontWeight: 700,
                        color: presetStyle.headerFillColor ? '#ffffff' : '#333333',
                    });
                }
            }
        }

        const activeSt = activeStory ?? engineRef.current.story;
        activeSt.insertInlineObject(offset, table);
        setSelection([offset + 1, offset + 1]);
        setActiveTableRef(table);
        recompose();
    }, [selection, recompose, activeStory, tableRows, tableCols, tablePreset, tableRowHeightMode, tableCellPadding]);

    const handleAddRow = useCallback(() => {
        if (!activeTableRef) return;
        activeTableRef.addRow();
        recompose();
    }, [activeTableRef, recompose]);

    const handleDeleteRow = useCallback(() => {
        if (!activeTableRef) return;
        activeTableRef.deleteRow(activeTableRef.rows - 1);
        recompose();
    }, [activeTableRef, recompose]);

    const handleAddCol = useCallback(() => {
        if (!activeTableRef) return;
        activeTableRef.addColumn();
        recompose();
    }, [activeTableRef, recompose]);

    const handleDeleteCol = useCallback(() => {
        if (!activeTableRef) return;
        activeTableRef.deleteColumn(activeTableRef.cols - 1);
        recompose();
    }, [activeTableRef, recompose]);

    // ── JSON Loading ─────────────────────────────────────────────
    const loadJSON = useCallback(async (text: string) => {
        const engine = engineRef.current;
        const uiRenderer = uiRendererRef.current;
        const glRenderer = gpuRendererRef.current;
        if (!engine || !uiRenderer || !glRenderer) return;

        setIsLoadingJSON(true);
        setStatus('Parsing JSON…');
        setStatusDot('loading');
        try {
            const raw = JSON.parse(text) as unknown;
            const doc = parseLSXMLJson(raw);

            const pw = Math.round(doc.pageWidth);
            const ph = Math.round(doc.pageHeight);

            // Store graphic lines for overlay rendering
            graphicLinesRef.current = doc.graphicLines ?? [];

            // Pick the first story that has frames
            const storyId = doc.mainStoryId;
            const mainStory = doc.stories[storyId];
            if (!mainStory) throw new Error('No main story found in JSON');

            const mainFrames = doc.frames
                .filter(f => f.storyId === storyId)
                .sort((a, b) => {
                    if (b.prevFrameId === a.id) return -1;
                    if (a.prevFrameId === b.id) return 1;
                    return a.x - b.x;
                });

            if (mainFrames.length === 0) throw new Error('No text frames found for main story');

            const engineFrames = mainFrames.map(f => ({
                id: f.id,
                x: f.x,
                y: f.y,
                width: f.width,
                height: f.height,
                columns: f.columns,
                columnGap: f.columnGap,
                nextFrameId: f.nextFrameId,
                prevFrameId: f.prevFrameId,
                polygon: f.polygon,
            }));

            engine.updateConfig({
                frames: engineFrames,
                paperWidth: pw,
                paperHeight: ph,
                wrapObjects: [],
                defaultCharacterStyle: {
                    ...engine['_config'].defaultCharacterStyle,
                    fontSize: 12,
                    color: '#000000',
                },
                defaultParagraphStyle: {
                    ...engine['_config'].defaultParagraphStyle,
                    alignment: 'left',
                    spaceBefore: 0,
                    spaceAfter: 0,
                    firstLineIndent: 0,
                    composer: 'paragraph', // Knuth-Plass by default for JSON mode
                    leading: 1.4,
                },
            });

            engine.setText(mainStory.text);
            const story = engine.story;

            for (const span of mainStory.charSpans) {
                if (span.end > span.start && Object.keys(span.style).length > 0) {
                    story.applyCharacterStyle(span.start, span.end, span.style);
                }
            }

            for (const span of mainStory.paraSpans) {
                if (span.end > span.start && Object.keys(span.style).length > 0) {
                    story.applyParagraphStyle(span.start, span.end, span.style);
                }
            }

            // Register inline tables (U+FFFC placeholders are already in the text)
            for (const obj of mainStory.inlineObjects ?? []) {
                story.registerInlineObject(obj.offset, obj.table);
            }

            // Extend MSDF atlases to cover all characters present in the JSON text
            if (msdfGenRef.current && robotoTTFRef.current) {
                const currentCharset = baseCharsetRef.current;
                const jsonChars = [...new Set(mainStory.text)].filter(c => !currentCharset.includes(c)).join('');
                if (jsonChars.length > 0) {
                    setStatus('Rebuilding glyph atlas for JSON text…');
                    const extendedCharset = currentCharset + jsonChars;
                    baseCharsetRef.current = extendedCharset;
                    const newAtlas = await msdfGenRef.current.generateAtlas(robotoTTFRef.current.slice(0), extendedCharset, 4, [1024, 1024]);
                    atlasRef.current = newAtlas;
                    glRenderer.setAtlas(newAtlas);
                    if (robotoBoldTTFRef.current && 'setBoldAtlas' in glRenderer) {
                        const newBoldAtlas = await msdfGenRef.current.generateAtlas(robotoBoldTTFRef.current.slice(0), extendedCharset, 4, [1024, 1024]);
                        boldAtlasRef.current = newBoldAtlas;
                        (glRenderer as import('../renderer/WebGLRenderer').WebGLRenderer).setBoldAtlas(newBoldAtlas);
                    }
                }
            }

            uiRenderer.updateConfig({ paperWidth: pw, paperHeight: ph, drawText: canvas2DTextRef.current });
            if ('setPaperSize' in glRenderer) {
                (glRenderer as import('../renderer/WebGLRenderer').WebGLRenderer).setPaperSize(pw, ph);
            }

            setPaperWidth(pw);
            setPaperHeight(ph);
            setIsJSONMode(true);
            setPolygons([]);
            setSelection(null);
            setActiveStory(null);

            // Auto-fit zoom: calculate zoom so page width fits the canvas area
            const canvasAreaEl = document.querySelector('.canvas-area');
            const areaW = canvasAreaEl ? canvasAreaEl.clientWidth - 40 : window.innerWidth - 320;
            const areaH = canvasAreaEl ? canvasAreaEl.clientHeight - 40 : window.innerHeight - 76;
            const fitZoom = Math.max(0.05, Math.min(2.0, Math.min(areaW / pw, areaH / ph)));
            // Round to nearest 5% for a clean zoom value
            const snappedZoom = Math.round(fitZoom * 20) / 20;
            setZoom(snappedZoom);
            setPanX(0);
            setPanY(0);

            const result = engine.compose();
            setLayoutResult(result);
            glRenderer.setTransform(snappedZoom, 0, 0);
            glRenderer.render(result, atlasRef.current);
            uiRenderer.render(result, engine.frameManager.allFrames, null, [], glRenderer.getCanvas(), snappedZoom, undefined);
            if (graphicLinesRef.current.length > 0) {
                uiRenderer.drawGraphicLines(graphicLinesRef.current);
            }
            setStatus(`JSON loaded — ${result.lineCount} lines in ${result.composeTimeMs.toFixed(1)}ms`);
            setStatusDot('ok');
        } catch (err) {
            console.error('JSON load failed:', err);
            setStatus(`JSON error: ${err instanceof Error ? err.message : 'Unknown'}`);
            setStatusDot('error');
        } finally {
            setIsLoadingJSON(false);
        }
    }, [zoom, setActiveStory]);

    const handleLoadJSONFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        file.text().then(text => loadJSON(text));
        e.target.value = '';
    }, [loadJSON]);

    // ── Initialization ──────────────────────────────────────────
    useEffect(() => {
        let cancelled = false;
        async function init() {
            try {
                const config = { ...DEFAULT_ENGINE_CONFIG };
                config.frames[0]!.columns = columns;
                config.defaultCharacterStyle = { ...config.defaultCharacterStyle, fontSize };
                config.defaultParagraphStyle = {
                    ...config.defaultParagraphStyle,
                    leading, composer, alignment, tolerance,
                };
                const engine = new LayoutEngine(config);
                engineRef.current = engine;
                setStatus('Loading HarfBuzz WASM...');
                const fonts = [
                    { family: 'Roboto', url: 'https://raw.githubusercontent.com/googlefonts/roboto/main/src/hinted/Roboto-Regular.ttf', weight: '400', style: 'normal' },
                    { family: 'Roboto', url: 'https://raw.githubusercontent.com/googlefonts/roboto/main/src/hinted/Roboto-Bold.ttf', weight: '700', style: 'normal' },
                    { family: 'Roboto', url: 'https://raw.githubusercontent.com/googlefonts/roboto/main/src/hinted/Roboto-Italic.ttf', weight: '400', style: 'italic' },
                    { family: 'Roboto', url: 'https://raw.githubusercontent.com/googlefonts/roboto/main/src/hinted/Roboto-BoldItalic.ttf', weight: '700', style: 'italic' },
                ];
                await engine.init(fonts);
                if (cancelled) return;
                engine.setText(SAMPLE_TEXT);
                engine.story.applyCharacterStyle(0, 10, { color: '#e74c3c' });
                engine.story.applyCharacterStyle(18, 21, { color: '#2980b9' });
                engine.story.applyCharacterStyle(124, 135, { color: '#27ae60' });
                engine.story.applyCharacterStyle(236, 243, { color: '#8e44ad' });
                engine.story.applyCharacterStyle(250, 258, { color: '#e67e22' });
                // Initialize MSDF Generator and gather necessary charset
                msdfGenRef.current = new MSDFAtlasGenerator();
                await msdfGenRef.current.init();

                // Charset: ASCII + common Unicode chars + Latin-1 supplement + OpenType liga codepoints
                const charset = [
                    'abcdefghijklmnopqrstuvwxyz',
                    'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
                    "0123456789!@#$%^&*()_+-=[]{}|;:\",./<>? '",
                    '\u2014\u2013\u2011',   // em dash, en dash, non-breaking hyphen
                    '\u2018\u2019\u201C\u201D', // smart quotes
                    '\u00AE\u00A9\u2122',   // registered, copyright, trademark
                    '\u2022\u00B0\u00B5\u00A0', // bullet, degree, micro, nbsp
                    '\uFB00\uFB01\uFB02\uFB03\uFB04', // ff fi fl ffi ffl ligatures
                    // Latin-1 supplement (accented chars common in EU pharmaceutical docs)
                    '\u00C0\u00C1\u00C2\u00C3\u00C4\u00C5\u00C6\u00C7\u00C8\u00C9\u00CA\u00CB',
                    '\u00CC\u00CD\u00CE\u00CF\u00D0\u00D1\u00D2\u00D3\u00D4\u00D5\u00D6\u00D8',
                    '\u00D9\u00DA\u00DB\u00DC\u00DD\u00DE\u00DF',
                    '\u00E0\u00E1\u00E2\u00E3\u00E4\u00E5\u00E6\u00E7\u00E8\u00E9\u00EA\u00EB',
                    '\u00EC\u00ED\u00EE\u00EF\u00F0\u00F1\u00F2\u00F3\u00F4\u00F5\u00F6\u00F8',
                    '\u00F9\u00FA\u00FB\u00FC\u00FD\u00FE\u00FF',
                ].join('');
                const [robotoBlob, robotoBoldBlob] = await Promise.all([
                    fetch('https://raw.githubusercontent.com/googlefonts/roboto/main/src/hinted/Roboto-Regular.ttf').then(r => r.arrayBuffer()),
                    fetch('https://raw.githubusercontent.com/googlefonts/roboto/main/src/hinted/Roboto-Bold.ttf').then(r => r.arrayBuffer()),
                ]);

                // Cache TTF bytes for dynamic atlas regeneration when JSON is loaded
                robotoTTFRef.current = robotoBlob.slice(0);
                robotoBoldTTFRef.current = robotoBoldBlob.slice(0);
                baseCharsetRef.current = charset;

                setStatus('Generating Regular MSDF atlas…');
                const regularAtlas = await msdfGenRef.current.generateAtlas(robotoBlob, charset, 4, [1024, 1024]);
                atlasRef.current = regularAtlas;
                setStatus('Generating Bold MSDF atlas…');
                const boldAtlas = await msdfGenRef.current.generateAtlas(robotoBoldBlob.slice(0), charset, 4, [1024, 1024]);
                boldAtlasRef.current = boldAtlas;

                if (uiCanvasRef.current) {
                    const uiRenderer = new CanvasRenderer(uiCanvasRef.current, {
                        paperWidth: config.paperWidth,
                        paperHeight: config.paperHeight,
                        showColumns,
                        showBaselines,
                        drawText: false, // Text is handled by WebGL
                    });
                    uiRendererRef.current = uiRenderer;

                    // Create an off-DOM canvas for GPU rendering
                    const offscreenCanvas = document.createElement('canvas');
                    offscreenCanvas.width = config.paperWidth;
                    offscreenCanvas.height = config.paperHeight;

                    // Try WebGPU → WebGL 2 → Canvas 2D fallback
                    // Backend selection: WebGL 2 → Canvas 2D
                    // Use try/catch instead of isSupported() — some Linux/software-render
                    // environments pass the static check but still fail to create the context,
                    // or vice versa (static probe fails but actual creation works).
                    let gpuRenderer: IGPURenderer;

                    try {
                        gpuRenderer = new WebGLRenderer(offscreenCanvas, {
                            paperWidth: DEFAULT_ENGINE_CONFIG.paperWidth,
                            paperHeight: DEFAULT_ENGINE_CONFIG.paperHeight,
                        });
                        setGpuBackend('webgl');
                        canvas2DTextRef.current = false;
                    } catch {
                        // WebGL 2 unavailable — fall back to Canvas 2D text rendering
                        gpuRenderer = new NullGPURenderer();
                        setGpuBackend('canvas2d');
                        canvas2DTextRef.current = true;
                        uiRenderer.updateConfig({ drawText: true });
                    }

                    // Upload the generated MSDF atlas textures
                    gpuRenderer.setAtlas(atlasRef.current);
                    if (boldAtlasRef.current && 'setBoldAtlas' in gpuRenderer) {
                        (gpuRenderer as import('../renderer/WebGLRenderer').WebGLRenderer).setBoldAtlas(boldAtlasRef.current);
                    }

                    gpuRendererRef.current = gpuRenderer;

                    // Initial layout compose
                    const result = engine.compose();
                    setLayoutResult(result);

                    recompose();

                    setStatus(`Ready — ${result.lineCount} lines in ${result.composeTimeMs.toFixed(1)}ms`);
                    setStatusDot('ok');
                }
            } catch (err) {
                if (cancelled) return;
                console.error('Engine init failed:', err);
                setStatus(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
                setStatusDot('error');
            }
        }
        init();
        return () => { cancelled = true; };
    }, []);

    // Recompose when config changes
    useEffect(() => { recompose(); }, [recompose]);

    // Re-render when selection changes
    useEffect(() => {
        if (uiRendererRef.current && gpuRendererRef.current && engineRef.current && layoutResult) {
            gpuRendererRef.current.setTransform(zoom, 0, 0);
            gpuRendererRef.current.render(layoutResult, atlasRef.current);
            uiRendererRef.current.render(
                layoutResult,
                engineRef.current.frameManager.allFrames,
                selection,
                activeWrapObjects,
                gpuRendererRef.current.getCanvas(),
                zoom,
                activeStory ?? undefined
            );
            if (graphicLinesRef.current.length > 0) {
                uiRendererRef.current.drawGraphicLines(graphicLinesRef.current);
            }
            if (drawPoints.length > 0) {
                uiRendererRef.current.drawPolygonInProgress(drawPoints, cursorPt, SNAP_RADIUS);
            }
        }
        if (engineRef.current && selection) {
            const story = activeStory ?? engineRef.current.story;
            const offset = Math.min(selection[0], selection[1]);
            if (offset < story.text.length) {
                const charStyle = story.getCharacterStyleAt(offset);
                const paraStyle = story.getParagraphStyleAt(offset);
                setFontSize(charStyle.fontSize);
                setFontWeight(charStyle.fontWeight);
                setFontStyle(charStyle.fontStyle);
                setColor(charStyle.color);
                setTracking(charStyle.tracking);
                setLeading(charStyle.leading ?? paraStyle.leading);
                setAlignment(paraStyle.alignment);
                setComposer(paraStyle.composer);
                setTolerance(paraStyle.tolerance);
            }
        }
    }, [selection, layoutResult, activeWrapObjects, drawPoints, cursorPt, zoom, activeStory]);

    // ── Canvas draw-mode pointer handlers ───────────────────────
    const handleCanvasPointerDown = useCallback((e: React.PointerEvent) => {
        if (!drawMode) {
            // Normal text selection mode
            if (!engineRef.current) return;
            const pt = canvasPoint(e.clientX, e.clientY);
            if (!pt) return;
            const hit = engineRef.current.hitTest(pt.x, pt.y);
            if (hit) {
                setActiveStory(hit.story);
                setSelection([hit.offset, hit.offset]);
                setIsDragging(true);
                uiCanvasRef.current?.setPointerCapture(e.pointerId);
                // Ensure canvas area has focus for keyboard events
                ((e.currentTarget as HTMLElement).closest('.canvas-area') as HTMLElement | null)?.focus();
            } else {
                setSelection(null);
                setActiveStory(null);
            }
            return;
        }

        // Polygon drawing mode — place a vertex on single click
        const pt = canvasPoint(e.clientX, e.clientY);
        if (!pt) return;

        setDrawPoints(prev => {
            // Check snap-to-close
            if (prev.length >= 3) {
                const d = Math.hypot(pt.x - prev[0]!.x, pt.y - prev[0]!.y);
                if (d <= SNAP_RADIUS) {
                    // Close the polygon
                    finishPolygon(prev);
                    return [];
                }
            }
            return [...prev, pt];
        });
    }, [drawMode, canvasPoint, finishPolygon]);

    const handleCanvasPointerMove = useCallback((e: React.PointerEvent) => {
        if (drawMode) {
            const pt = canvasPoint(e.clientX, e.clientY);
            setCursorPt(pt);
            // Re-draw overlay live (must pass WebGL canvas to avoid black screen)
            if (layoutResult && uiRendererRef.current && engineRef.current) {
                uiRendererRef.current.render(
                    layoutResult, engineRef.current.frameManager.allFrames, selection, activeWrapObjects,
                    gpuRendererRef.current?.getCanvas(),
                    zoom
                );
                if (drawPoints.length > 0) {
                    uiRendererRef.current.drawPolygonInProgress(drawPoints, pt, SNAP_RADIUS);
                }
            }
            return;
        }
        if (!isDragging || !engineRef.current || !selection) return;
        const pt = canvasPoint(e.clientX, e.clientY);
        if (!pt) return;
        const hit = engineRef.current.hitTest(pt.x, pt.y);
        // Only extend selection if dragging in the SAME story
        if (hit && activeStory === hit.story) {
            setSelection([selection[0], hit.offset]);
        }
    }, [drawMode, isDragging, selection, canvasPoint, layoutResult, drawPoints, activeWrapObjects, activeStory]);

    const handleCanvasDoubleClick = useCallback((e: React.MouseEvent) => {
        if (!drawMode) return;
        // Double-click closes the polygon (remove last point which was added by the first click of dblclick)
        setDrawPoints(prev => {
            const pts = prev.length > 0 ? prev.slice(0, -1) : prev;
            if (pts.length >= 3) {
                finishPolygon(pts);
            }
            return [];
        });
        e.preventDefault();
    }, [drawMode, finishPolygon]);

    // ── Keyboard handlers ───────────────────────────────────────
    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        // ESC cancels drawing
        if (e.key === 'Escape') {
            if (drawMode) { cancelDraw(); return; }
        }
        // Enter closes the polygon
        if (e.key === 'Enter' && drawMode) {
            const pts = drawPoints;
            if (pts.length >= 3) finishPolygon(pts);
            else cancelDraw();
            return;
        }

        if (!engineRef.current || drawMode) return;
        if (!selection) return;
        const engine = engineRef.current;
        const story = activeStoryRef.current ?? engine.story;
        const [s1, s2] = selection;
        let start = Math.max(0, Math.min(s1, s2));
        let end = Math.min(story.length, Math.max(s1, s2));
        // If stale selection completely out of bounds from rapid typing, clamp it:
        if (start > story.length) start = story.length;
        if (end < start) end = start;
        const hasSelection = start !== end;

        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
            e.preventDefault();
            if (e.shiftKey) story.redo(); else story.undo();
            recomposeDeferred(); return;
        }
        if (e.key === 'ArrowLeft') {
            e.preventDefault();
            if (e.shiftKey) setSelection([selection[0], Math.max(0, selection[1] - 1)]);
            else { const p = hasSelection ? start : Math.max(0, start - 1); setSelection([p, p]); }
            return;
        }
        if (e.key === 'ArrowRight') {
            e.preventDefault();
            if (e.shiftKey) setSelection([selection[0], Math.min(story.length, selection[1] + 1)]);
            else { const p = hasSelection ? end : Math.min(story.length, end + 1); setSelection([p, p]); }
            return;
        }
        if (e.key === 'Backspace') {
            e.preventDefault();
            if (hasSelection) { story.delete(start, end - start); setSelection([start, start]); }
            else if (start > 0) { story.delete(start - 1, 1); setSelection([start - 1, start - 1]); }
            recomposeDeferred(); return;
        }
        if (e.key === 'Delete') {
            e.preventDefault();
            if (hasSelection) { story.delete(start, end - start); setSelection([start, start]); }
            else if (start < story.length) { story.delete(start, 1); setSelection([start, start]); }
            recomposeDeferred(); return;
        }
        // Zoom keyboard shortcuts
        if ((e.metaKey || e.ctrlKey) && (e.key === '=' || e.key === '+')) {
            e.preventDefault();
            setZoom(z => Math.min(4.0, z * 1.25));
            return;
        }
        if ((e.metaKey || e.ctrlKey) && e.key === '-') {
            e.preventDefault();
            setZoom(z => Math.max(1.0, z / 1.25));
            return;
        }
        if ((e.metaKey || e.ctrlKey) && e.key === '0') {
            e.preventDefault();
            setZoom(1.0); setPanX(0); setPanY(0);
            return;
        }
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        if (e.key.length === 1 || e.key === 'Enter') {
            e.preventDefault();
            const char = e.key === 'Enter' ? '\n' : e.key;
            if (hasSelection) story.delete(start, end - start);
            story.insert(start, char);
            setSelection([start + 1, start + 1]);
            recomposeDeferred();
        }
    }, [drawMode, drawPoints, cancelDraw, finishPolygon, selection, recompose, recomposeDeferred, activeStory]);

    // ── Zoom / Pan handlers ──────────────────────────────────────
    // Use a ref to track zoom/pan for zoom-to-cursor math (avoids stale closures)
    const zoomPanRef = useRef({ zoom, panX, panY });
    zoomPanRef.current = { zoom, panX, panY };

    const handleWheel = useCallback((e: WheelEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const state = zoomPanRef.current;
        if (e.ctrlKey || e.metaKey) {
            // Ctrl+scroll = zoom centered on cursor
            const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
            const oldZoom = state.zoom;
            const newZoom = Math.min(4.0, Math.max(1.0, oldZoom * factor));
            if (newZoom === oldZoom) return;

            const main = (e.target as HTMLElement).closest('.canvas-area');
            if (main) {
                const mainRect = main.getBoundingClientRect();
                const mx = e.clientX - mainRect.left;
                const my = e.clientY - mainRect.top;
                const layoutX = (mx - state.panX) / oldZoom;
                const layoutY = (my - state.panY) / oldZoom;
                const rawPanX = mx - layoutX * newZoom;
                const rawPanY = my - layoutY * newZoom;
                setPanX(rawPanX);
                setPanY(rawPanY);
                zoomPanRef.current.panX = rawPanX;
                zoomPanRef.current.panY = rawPanY;
            }
            setZoom(newZoom);
            zoomPanRef.current.zoom = newZoom;
        } else {
            // Plain scroll = pan
            const rawPanX = state.panX - e.deltaX * 0.5;
            const rawPanY = state.panY - e.deltaY * 0.5;
            setPanX(rawPanX);
            setPanY(rawPanY);
            zoomPanRef.current.panX = rawPanX;
            zoomPanRef.current.panY = rawPanY;
        }
    }, []);

    // Register wheel handler on document in CAPTURE phase with { passive: false }
    useEffect(() => {
        const docHandler = (e: WheelEvent) => {
            const target = e.target as HTMLElement;
            if (!target?.closest?.('.canvas-area')) return;
            handleWheel(e);
        };
        document.addEventListener('wheel', docHandler, { passive: false, capture: true });
        return () => document.removeEventListener('wheel', docHandler, { capture: true });
    }, [handleWheel]);

    const handlePanPointerDown = useCallback((e: React.PointerEvent) => {
        // Middle mouse button (button 1) starts panning
        if (e.button === 1) {
            e.preventDefault();
            setIsPanning(true);
            panStartRef.current = { x: e.clientX, y: e.clientY, panX, panY };
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
        }
    }, [panX, panY]);

    const handlePanPointerMove = useCallback((e: React.PointerEvent) => {
        if (isPanning && panStartRef.current) {
            const dx = e.clientX - panStartRef.current.x;
            const dy = e.clientY - panStartRef.current.y;
            setPanX(panStartRef.current.panX + dx);
            setPanY(panStartRef.current.panY + dy);
        }
    }, [isPanning]);

    const handlePanPointerUp = useCallback((e: React.PointerEvent) => {
        if (e.button === 1 && isPanning) {
            setIsPanning(false);
            panStartRef.current = null;
            try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch { }
        }
    }, [isPanning]);

    const resetZoomPan = useCallback(() => {
        setZoom(1.0);
        setPanX(0);
        setPanY(0);
    }, []);

    // ── Cursor style ────────────────────────────────────────────
    const canvasCursor = isPanning ? 'grabbing' : drawMode ? 'crosshair' : 'text';

    // ── Render ──────────────────────────────────────────────────
    return (
        <div className="app">
            {/* Sidebar */}
            <aside className="sidebar">
                <div className="sidebar__header">
                    <div className="sidebar__logo">R</div>
                    <span className="sidebar__title">Rusty Text Engine</span>
                    <span className="sidebar__version">v0.1</span>
                </div>

                {/* JSON Import */}
                <div className="control-group">
                    <label className="control-group__label">JSON Import</label>
                    <label style={{ display: 'block', cursor: 'pointer' }}>
                        <div style={{ width: '100%', padding: '7px 8px', fontSize: '13px', fontWeight: 600, background: isJSONMode ? '#1a6b3a' : 'var(--accent-primary)', color: '#fff', border: 'none', borderRadius: '6px', textAlign: 'center', cursor: 'pointer', marginBottom: '6px', opacity: isLoadingJSON ? 0.6 : 1 }}>
                            {isLoadingJSON ? '⏳ Loading…' : isJSONMode ? '✓ JSON Loaded' : '📋 Open JSON file…'}
                        </div>
                        <input type="file" accept=".json" style={{ display: 'none' }} onChange={handleLoadJSONFile} disabled={isLoadingJSON} />
                    </label>
                    {isJSONMode && (
                        <div style={{ fontSize: '11px', color: '#63cab7', marginTop: '4px' }}>
                            {paperWidth}×{paperHeight} pt · Knuth-Plass composer
                        </div>
                    )}
                </div>

                {/* Composer */}
                <div className="control-group">
                    <label className="control-group__label">Composer</label>
                    <select value={composer} onChange={(e) => { const val = e.target.value as ComposerType; setComposer(val); updateStyle('para', { composer: val }); }}>
                        <option value="paragraph">Paragraph (Knuth-Plass)</option>
                        <option value="singleLine">Single-Line (Greedy)</option>
                    </select>
                </div>

                {/* Alignment */}
                <div className="control-group">
                    <label className="control-group__label">Alignment</label>
                    <select value={alignment} onChange={(e) => { const val = e.target.value as TextAlignment; setAlignment(val); updateStyle('para', { alignment: val }); }}>
                        <option value="justify">Justify</option>
                        <option value="left">Left</option>
                        <option value="right">Right</option>
                        <option value="center">Center</option>
                        <option value="forceJustify">Force Justify</option>
                    </select>
                </div>

                {/* Typography */}
                <div className="control-group">
                    <label className="control-group__label">Typography</label>
                    <div className="control-row"><span className="control-row__name">Font Size</span><span className="control-row__value">{fontSize}px</span></div>
                    <input type="range" min={8} max={36} step={1} value={fontSize} onChange={(e) => { const v = Number(e.target.value); setFontSize(v); updateStyle('char', { fontSize: v }); }} />
                    <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                        <button style={{ flex: 1, padding: '4px', background: fontWeight > 400 ? 'var(--accent-primary)' : 'var(--bg-surface)', color: fontWeight > 400 ? 'white' : 'var(--text-primary)', border: '1px solid var(--border-subtle)', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
                            onClick={() => { const w = fontWeight === 400 ? 700 : 400; setFontWeight(w); updateStyle('char', { fontWeight: w }); }}>B</button>
                        <button style={{ flex: 1, padding: '4px', background: fontStyle === 'italic' ? 'var(--accent-primary)' : 'var(--bg-surface)', color: fontStyle === 'italic' ? 'white' : 'var(--text-primary)', border: '1px solid var(--border-subtle)', borderRadius: '4px', cursor: 'pointer', fontStyle: 'italic' }}
                            onClick={() => { const s = fontStyle === 'normal' ? 'italic' : 'normal'; setFontStyle(s); updateStyle('char', { fontStyle: s }); }}>I</button>
                        <input type="color" value={color} style={{ flex: 1, height: '28px', padding: '0', cursor: 'pointer', border: '1px solid var(--border-subtle)', borderRadius: '4px', background: 'var(--bg-surface)' }}
                            onChange={(e) => { setColor(e.target.value); updateStyle('char', { color: e.target.value }); }} />
                    </div>
                    <div className="control-row"><span className="control-row__name">Tracking</span><span className="control-row__value">{tracking.toFixed(2)}em</span></div>
                    <input type="range" min={-0.1} max={0.5} step={0.01} value={tracking} onChange={(e) => { const v = Number(e.target.value); setTracking(v); updateStyle('char', { tracking: v }); }} />
                    <div className="control-row"><span className="control-row__name">Leading</span><span className="control-row__value">{leading.toFixed(1)}×</span></div>
                    <input type="range" min={1.0} max={3.0} step={0.1} value={leading} onChange={(e) => { const v = parseFloat(e.target.value); setLeading(v); updateStyle('char', { leading: v }); }} />
                    <div className="control-row"><span className="control-row__name">Tolerance</span><span className="control-row__value">{tolerance}</span></div>
                    <input type="range" min={1} max={10} step={1} value={tolerance} onChange={(e) => { const v = Number(e.target.value); setTolerance(v); updateStyle('para', { tolerance: v }); }} />
                </div>

                {/* Layout */}
                <div className="control-group">
                    <label className="control-group__label">Layout</label>
                    <div className="control-row"><span className="control-row__name">Columns</span><span className="control-row__value">{columns}</span></div>
                    <input type="range" min={1} max={6} step={1} value={columns} onChange={(e) => setColumns(Number(e.target.value))} />
                    <div className="control-row"><span className="control-row__name">Column Gap</span><span className="control-row__value">{columnGap}px</span></div>
                    <input type="range" min={0} max={60} step={2} value={columnGap} onChange={(e) => setColumnGap(Number(e.target.value))} />
                </div>

                {/* Table Controls */}
                <div className="control-group">
                    <label className="control-group__label">Table</label>

                    {/* Preset selector */}
                    <div className="control-row">
                        <span className="control-row__name">Style</span>
                        <select value={tablePreset} onChange={(e) => setTablePreset(e.target.value as TablePreset)}
                            style={{ flex: 1, background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', borderRadius: '4px', padding: '3px 6px', fontSize: '12px' }}>
                            <option value="plain">Plain</option>
                            <option value="striped">Striped</option>
                            <option value="headerStriped">Header + Striped</option>
                            <option value="darkHeader">Dark Header</option>
                        </select>
                    </div>

                    {/* Rows & Cols */}
                    <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                        <div style={{ flex: 1 }}>
                            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '2px' }}>Rows</div>
                            <input type="number" min={1} max={20} value={tableRows}
                                onChange={(e) => setTableRows(Math.max(1, Math.min(20, Number(e.target.value))))}
                                style={{ width: '100%', background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', borderRadius: '4px', padding: '3px 6px', fontSize: '12px' }} />
                        </div>
                        <div style={{ flex: 1 }}>
                            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '2px' }}>Cols</div>
                            <input type="number" min={1} max={10} value={tableCols}
                                onChange={(e) => setTableCols(Math.max(1, Math.min(10, Number(e.target.value))))}
                                style={{ width: '100%', background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', borderRadius: '4px', padding: '3px 6px', fontSize: '12px' }} />
                        </div>
                    </div>

                    {/* Row Height Mode */}
                    <div className="control-row" style={{ marginTop: '4px' }}>
                        <span className="control-row__name">Height</span>
                        <select value={tableRowHeightMode} onChange={(e) => setTableRowHeightMode(e.target.value as RowHeightMode)}
                            style={{ flex: 1, background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', borderRadius: '4px', padding: '3px 6px', fontSize: '12px' }}>
                            <option value="atLeast">At Least</option>
                            <option value="exactly">Exactly</option>
                        </select>
                    </div>

                    {/* Cell Padding */}
                    <div className="control-row" style={{ marginTop: '4px' }}>
                        <span className="control-row__name">Padding</span>
                        <span className="control-row__value">{tableCellPadding}px</span>
                    </div>
                    <input type="range" min={0} max={20} step={1} value={tableCellPadding}
                        onChange={(e) => setTableCellPadding(Number(e.target.value))} />

                    {/* Insert Button */}
                    <button
                        onClick={insertTable}
                        disabled={!selection}
                        style={{ marginTop: '6px', padding: '7px 8px', fontSize: '13px', fontWeight: 600, background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', width: '100%', opacity: selection ? 1 : 0.5 }}
                    >
                        ⊞ Insert {tableRows}×{tableCols} Table
                    </button>
                    {!selection && <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px' }}>Click in text to insert</div>}

                    {/* Row/Col Operations (shown when a table is active) */}
                    {activeTableRef && (
                        <div style={{ marginTop: '8px', display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                            <button onClick={handleAddRow} style={{ flex: 1, padding: '4px', fontSize: '11px', background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', borderRadius: '4px', cursor: 'pointer' }}>+ Row</button>
                            <button onClick={handleDeleteRow} style={{ flex: 1, padding: '4px', fontSize: '11px', background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', borderRadius: '4px', cursor: 'pointer' }}>− Row</button>
                            <button onClick={handleAddCol} style={{ flex: 1, padding: '4px', fontSize: '11px', background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', borderRadius: '4px', cursor: 'pointer' }}>+ Col</button>
                            <button onClick={handleDeleteCol} style={{ flex: 1, padding: '4px', fontSize: '11px', background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', borderRadius: '4px', cursor: 'pointer' }}>− Col</button>
                            <div style={{ width: '100%', fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                                Active: {activeTableRef.rows}×{activeTableRef.cols}
                            </div>
                        </div>
                    )}
                </div>

                {/* Display */}
                <div className="control-group">
                    <label className="control-group__label">Display</label>
                    {[
                        ['Show column guides', showColumns, setShowColumns],
                        ['Show baselines', showBaselines, setShowBaselines],
                        ['Optical margins', opticalMargins, (v: boolean) => { setOpticalMargins(v); updateStyle('para', { opticalMargins: v }); }],
                        ['Hz-program scaling', hzProgramEnabled, (v: boolean) => { setHzProgramEnabled(v); updateStyle('para', { hzProgram: v ? { minScale: 0.97, maxScale: 1.03 } : null }); }],
                    ].map(([label, checked, onChange]) => (
                        <label key={label as string} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--text-secondary)', cursor: 'pointer', marginTop: '6px' }}>
                            <input type="checkbox" checked={checked as boolean} onChange={(e) => (onChange as Function)(e.target.checked)} />
                            {label as string}
                        </label>
                    ))}
                </div>

                {/* ── Wrap Polygons ─────────────────────────────── */}
                {!isJSONMode && <div className="control-group">
                    <label className="control-group__label">Wrap Polygons</label>

                    {/* Draw tool toggle */}
                    <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
                        <button
                            onClick={() => {
                                if (drawMode) cancelDraw();
                                else { setDrawMode(true); setSelection(null); }
                            }}
                            style={{
                                flex: 1, padding: '6px 8px', fontSize: '12px', fontWeight: 600,
                                background: drawMode ? '#22c55e' : 'var(--accent-primary)',
                                color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer',
                            }}
                        >
                            {drawMode ? '✏ Drawing… (ESC cancel)' : '✏ Draw Polygon'}
                        </button>
                        <button
                            onClick={addDemoEllipse}
                            title="Add a demo ellipse wrap object"
                            style={{ padding: '6px 8px', fontSize: '12px', background: 'var(--bg-surface)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)', borderRadius: '6px', cursor: 'pointer' }}
                        >
                            ⊙ Ellipse
                        </button>
                    </div>

                    {drawMode && (
                        <div style={{ fontSize: '11px', color: '#63cab7', marginBottom: '8px', lineHeight: 1.5 }}>
                            Click on canvas to add vertices.<br />
                            Click near start (yellow) or press <b>Enter</b> to close.<br />
                            Press <b>ESC</b> to cancel.
                        </div>
                    )}

                    {/* Polygon list */}
                    {polygons.length === 0 && (
                        <div style={{ fontSize: '12px', color: 'var(--text-secondary)', opacity: 0.6, marginTop: '4px' }}>
                            No polygons yet. Draw one or add an ellipse.
                        </div>
                    )}

                    {polygons.map(poly => (
                        <div key={poly.id} style={{
                            background: 'var(--bg-surface)', borderRadius: '6px', padding: '8px',
                            marginTop: '6px', border: `1px solid ${poly.enabled ? 'rgba(99,202,183,0.3)' : 'var(--border-subtle)'}`,
                            opacity: poly.enabled ? 1 : 0.5,
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                                <input type="checkbox" checked={poly.enabled} onChange={() => togglePolygon(poly.id)}
                                    style={{ accentColor: '#63cab7' }} />
                                <span style={{ flex: 1, fontSize: '12px', color: 'var(--text-primary)', fontWeight: 500 }}>
                                    {poly.label}
                                </span>
                                <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                                    {poly.points.length}pt
                                </span>
                                <button onClick={() => deletePolygon(poly.id)} title="Delete"
                                    style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '14px', lineHeight: 1, padding: 0 }}>
                                    ×
                                </button>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span style={{ fontSize: '11px', color: 'var(--text-secondary)', minWidth: '50px' }}>
                                    Pad {poly.padding}px
                                </span>
                                <input type="range" min={0} max={30} step={1} value={poly.padding}
                                    onChange={(e) => updatePadding(poly.id, Number(e.target.value))}
                                    style={{ flex: 1 }} />
                            </div>
                        </div>
                    ))}
                </div>}

                {/* Stats */}
                {layoutResult && (
                    <div className="control-group">
                        <label className="control-group__label">Statistics</label>
                        <div className="control-row"><span className="control-row__name">Lines</span><span className="control-row__value">{layoutResult.lineCount}</span></div>
                        <div className="control-row"><span className="control-row__name">Glyphs</span><span className="control-row__value">{layoutResult.glyphCount}</span></div>
                        <div className="control-row"><span className="control-row__name">Layout Time</span><span className="control-row__value">{layoutResult.composeTimeMs.toFixed(1)}ms</span></div>
                        {!isJSONMode && <div className="control-row"><span className="control-row__name">Polygons</span><span className="control-row__value">{polygons.filter(p => p.enabled).length}/{polygons.length}</span></div>}
                    </div>
                )}
            </aside>

            {/* Canvas Area */}
            <main
                className="canvas-area"
                tabIndex={0}
                style={{ outline: 'none', position: 'relative', overflow: 'hidden' }}
                onKeyDown={handleKeyDown}
                onPointerDown={(e) => { handlePanPointerDown(e); if (e.button !== 1) handleCanvasPointerDown(e); }}
                onPointerMove={(e) => { handlePanPointerMove(e); if (!isPanning) handleCanvasPointerMove(e); }}
                onPointerUp={(e) => {
                    handlePanPointerUp(e);
                    if (!drawMode && e.button === 0) {
                        setIsDragging(false);
                        try { uiCanvasRef.current?.releasePointerCapture(e.pointerId); } catch { }
                    }
                }}
                onDoubleClick={handleCanvasDoubleClick}
            >
                <div
                    key="webgl-fix-remount"
                    style={{
                        position: 'relative',
                        width: paperWidth * zoom,
                        height: paperHeight * zoom,
                        background: '#ffffff',
                        boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
                        overflow: 'hidden',
                        marginLeft: panX,
                        marginTop: panY,
                    }}>
                    {/* Only the Canvas2D is in the DOM to avoid compositing bugs. It will paint the WebGL output natively. */}
                    <canvas
                        ref={uiCanvasRef}
                        style={{ position: 'absolute', top: 0, left: 0, width: paperWidth * zoom, height: paperHeight * zoom, zIndex: 2, touchAction: 'none', cursor: canvasCursor, pointerEvents: 'auto' }}
                    />
                </div>
            </main>

            {/* Status Bar */}
            <footer className="status-bar">
                <div className="status-bar__item">
                    <span className={`status-dot status-dot--${statusDot}`} />
                    <span>{status}</span>
                </div>
                <div className="status-bar__item">
                    HarfBuzz WASM {statusDot === 'ok' ? '✓' : statusDot === 'loading' ? '…' : '✗'}
                </div>
                <div className="status-bar__item">
                    {composer === 'paragraph' ? 'Knuth-Plass' : 'Greedy'} Composer
                </div>
                <div className="status-bar__item" style={{ opacity: 0.7, fontSize: '11px' }}>
                    {gpuBackend === 'webgl' ? '🔵 WebGL' : '⬜ Canvas 2D'}
                </div>
                {drawMode && (
                    <div className="status-bar__item" style={{ color: '#63cab7', fontWeight: 600 }}>
                        ✏ Polygon Draw — {drawPoints.length} vertices placed
                    </div>
                )}
                <div className="status-bar__item" style={{ marginLeft: 'auto' }}>
                    <span style={{ opacity: 0.7, fontSize: '11px' }}>{Math.round(zoom * 100)}%</span>
                    {zoom !== 1.0 && (
                        <button
                            onClick={resetZoomPan}
                            style={{ marginLeft: '6px', background: 'none', border: '1px solid var(--border-subtle)', borderRadius: '3px', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '10px', padding: '1px 4px' }}
                        >Reset</button>
                    )}
                </div>
            </footer>
        </div>
    );
}
