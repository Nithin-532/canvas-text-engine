/* ═══════════════════════════════════════════════════════════════
   App — React Application Shell
   
   Premium dark-themed UI with sidebar controls and canvas area
   for the text layout engine.
   ═══════════════════════════════════════════════════════════════ */

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { LayoutEngine } from '../layout/LayoutEngine';
import { CanvasRenderer } from '../renderer/CanvasRenderer';
import { WebGLRenderer } from '../renderer/WebGLRenderer';
import { WebGPURenderer, isWebGPUAvailable } from '../renderer/WebGPURenderer';
import type { IGPURenderer } from '../renderer/GPURendererInterface';
import { MSDFAtlasGenerator } from '../renderer/MSDFAtlasGenerator';
import type { MSDFAtlas } from '@zappar/msdf-generator';
import type { LayoutResult, ComposerType, TextAlignment, WrapObject } from '../types';
import { DEFAULT_ENGINE_CONFIG } from '../types';
import { makeEllipsePolygon } from '../geometry/Polygon';

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
    const [gpuBackend, setGpuBackend] = useState<'webgl' | 'webgpu'>('webgl');

    const [status, setStatus] = useState<string>('Initializing...');
    const [statusDot, setStatusDot] = useState<'loading' | 'ok' | 'error'>('loading');
    const [layoutResult, setLayoutResult] = useState<LayoutResult | null>(null);
    const [selection, setSelection] = useState<[number, number] | null>(null);
    const [isDragging, setIsDragging] = useState(false);

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

    const recompose = useCallback((wraps?: WrapObject[]) => {
        const engine = engineRef.current;
        const uiRenderer = uiRendererRef.current;
        const glRenderer = gpuRendererRef.current;
        const currentZoom = zoomRef.current;

        if (!engine || !uiRenderer || !glRenderer || engine.status.state !== 'ready') return;

        const wrapObjects = wraps ?? activeWrapObjects;

        engine.updateConfig({
            frames: [{
                ...DEFAULT_ENGINE_CONFIG.frames[0]!,
                columns,
                columnGap,
            }],
            wrapObjects,
        });

        uiRenderer.updateConfig({ showColumns, showBaselines, drawText: false });

        const result = engine.compose();
        setLayoutResult(result);

        // Render MSDF text on bottom layer
        glRenderer.setTransform(currentZoom, 0, 0);
        glRenderer.render(result, atlasRef.current);

        // Render UI overlays on top layer, drawing the WebGL offscreen canvas onto it first
        uiRenderer.render(result, engine.frameManager.allFrames, selection, wrapObjects, glRenderer.getCanvas(), currentZoom);

        setStatus(`Ready — ${result.lineCount} lines in ${result.composeTimeMs.toFixed(1)}ms`);
        setStatusDot('ok');
        return result;
    }, [columns, columnGap, showColumns, showBaselines, selection, activeWrapObjects]);

    // Re-render (without recomposing layout) when zoom changes
    useEffect(() => {
        const glRenderer = gpuRendererRef.current;
        const uiRenderer = uiRendererRef.current;
        const engine = engineRef.current;
        if (!glRenderer || !uiRenderer || !engine || !layoutResult) return;

        glRenderer.setTransform(zoom, 0, 0);
        glRenderer.render(layoutResult, atlasRef.current);
        uiRenderer.render(
            layoutResult,
            engine.frameManager.allFrames,
            selection,
            activeWrapObjects,
            glRenderer.getCanvas(),
            zoom
        );
    }, [zoom, layoutResult, selection, activeWrapObjects]);


    const updateStyle = useCallback((type: 'char' | 'para', partialStyle: any) => {
        const engine = engineRef.current;
        if (!engine) return;
        const targetStart = selection && selection[0] !== selection[1] ? Math.min(selection[0], selection[1]) : 0;
        const targetEnd = selection && selection[0] !== selection[1] ? Math.max(selection[0], selection[1]) : engine.story.text.length;
        if (type === 'char') {
            engine.story.applyCharacterStyle(targetStart, targetEnd, partialStyle);
        } else {
            engine.story.applyParagraphStyle(targetStart, targetEnd, partialStyle);
        }
        recompose();
    }, [selection, recompose]);

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

                // For MVP, generate a static atlas containing all ASCII + specific chars used.
                const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+-=[]{}|;:",./<>? \'’—';
                const robotoBlob = await (await fetch('https://raw.githubusercontent.com/googlefonts/roboto/main/src/hinted/Roboto-Regular.ttf')).arrayBuffer();

                atlasRef.current = await msdfGenRef.current.generateAtlas(robotoBlob, charset, 4, [1024, 1024]);

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

                    // Try WebGPU first, fall back to WebGL
                    let gpuRenderer: IGPURenderer;
                    if (isWebGPUAvailable()) {
                        setStatus('Initializing WebGPU...');
                        const webgpuRenderer = new WebGPURenderer(offscreenCanvas, {
                            paperWidth: DEFAULT_ENGINE_CONFIG.paperWidth,
                            paperHeight: DEFAULT_ENGINE_CONFIG.paperHeight,
                        });
                        const ok = await webgpuRenderer.init();
                        if (ok) {
                            gpuRenderer = webgpuRenderer;
                            setGpuBackend('webgpu');
                        } else {
                            // WebGPU init failed, fall back
                            gpuRenderer = new WebGLRenderer(offscreenCanvas, {
                                paperWidth: DEFAULT_ENGINE_CONFIG.paperWidth,
                                paperHeight: DEFAULT_ENGINE_CONFIG.paperHeight,
                            });
                            setGpuBackend('webgl');
                        }
                    } else {
                        gpuRenderer = new WebGLRenderer(offscreenCanvas, {
                            paperWidth: DEFAULT_ENGINE_CONFIG.paperWidth,
                            paperHeight: DEFAULT_ENGINE_CONFIG.paperHeight,
                        });
                        setGpuBackend('webgl');
                    }

                    // Upload the generated MSDF atlas texture
                    gpuRenderer.setAtlas(atlasRef.current);

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
        // eslint-disable-next-line react-hooks/exhaustive-deps
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
                zoom
            );
            if (drawPoints.length > 0) {
                uiRendererRef.current.drawPolygonInProgress(drawPoints, cursorPt, SNAP_RADIUS);
            }
        }
        if (engineRef.current && selection) {
            const offset = Math.min(selection[0], selection[1]);
            if (offset < engineRef.current.story.text.length) {
                const charStyle = engineRef.current.story.getCharacterStyleAt(offset);
                const paraStyle = engineRef.current.story.getParagraphStyleAt(offset);
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
    }, [selection, layoutResult, activeWrapObjects, drawPoints, cursorPt, zoom]);

    // ── Canvas draw-mode pointer handlers ───────────────────────
    const handleCanvasPointerDown = useCallback((e: React.PointerEvent) => {
        if (!drawMode) {
            // Normal text selection mode
            if (!engineRef.current) return;
            const pt = canvasPoint(e.clientX, e.clientY);
            if (!pt) return;
            const offset = engineRef.current.hitTest(pt.x, pt.y);
            if (offset !== -1) {
                setSelection([offset, offset]);
                setIsDragging(true);
                uiCanvasRef.current?.setPointerCapture(e.pointerId);
            } else {
                setSelection(null);
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
        const offset = engineRef.current.hitTest(pt.x, pt.y);
        if (offset !== -1) setSelection([selection[0], offset]);
    }, [drawMode, isDragging, selection, canvasPoint, layoutResult, drawPoints, activeWrapObjects]);

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

        if (!engineRef.current || !selection || drawMode) return;
        const engine = engineRef.current;
        const story = engine.story;
        const [s1, s2] = selection;
        let start = Math.min(s1, s2);
        let end = Math.max(s1, s2);
        let hasSelection = start !== end;

        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
            e.preventDefault();
            if (e.shiftKey) story.redo(); else story.undo();
            recompose(); return;
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
            recompose(); return;
        }
        if (e.key === 'Delete') {
            e.preventDefault();
            if (hasSelection) { story.delete(start, end - start); setSelection([start, start]); }
            else if (start < story.length) { story.delete(start, 1); setSelection([start, start]); }
            recompose(); return;
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
            recompose();
        }
    }, [drawMode, drawPoints, cancelDraw, finishPolygon, selection, recompose]);

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
                <div className="control-group">
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
                </div>

                {/* Stats */}
                {layoutResult && (
                    <div className="control-group">
                        <label className="control-group__label">Statistics</label>
                        <div className="control-row"><span className="control-row__name">Lines</span><span className="control-row__value">{layoutResult.lineCount}</span></div>
                        <div className="control-row"><span className="control-row__name">Glyphs</span><span className="control-row__value">{layoutResult.glyphCount}</span></div>
                        <div className="control-row"><span className="control-row__name">Layout Time</span><span className="control-row__value">{layoutResult.composeTimeMs.toFixed(1)}ms</span></div>
                        <div className="control-row"><span className="control-row__name">Polygons</span><span className="control-row__value">{polygons.filter(p => p.enabled).length}/{polygons.length}</span></div>
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
                        width: DEFAULT_ENGINE_CONFIG.paperWidth * zoom,
                        height: DEFAULT_ENGINE_CONFIG.paperHeight * zoom,
                        background: '#ffffff',
                        boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
                        overflow: 'hidden',
                        marginLeft: panX,
                        marginTop: panY,
                    }}>
                    {/* Only the Canvas2D is in the DOM to avoid compositing bugs. It will paint the WebGL output natively. */}
                    <canvas
                        ref={uiCanvasRef}
                        style={{ position: 'absolute', top: 0, left: 0, width: DEFAULT_ENGINE_CONFIG.paperWidth * zoom, height: DEFAULT_ENGINE_CONFIG.paperHeight * zoom, zIndex: 2, touchAction: 'none', cursor: canvasCursor, pointerEvents: 'auto' }}
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
                    {gpuBackend === 'webgpu' ? '🟢 WebGPU' : '🔵 WebGL'}
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
