/* ═══════════════════════════════════════════════════════════════
   App — React Application Shell
   
   Premium dark-themed UI with sidebar controls and canvas area
   for the text layout engine.
   ═══════════════════════════════════════════════════════════════ */

import { useEffect, useRef, useState, useCallback } from 'react';
import { LayoutEngine } from '../layout/LayoutEngine';
import { CanvasRenderer } from '../renderer/CanvasRenderer';
import type { LayoutResult, ComposerType, TextAlignment } from '../types';
import { DEFAULT_ENGINE_CONFIG } from '../types';

const SAMPLE_TEXT = `Typography is the art and technique of arranging type to make written language legible, readable, and appealing when displayed. The arrangement of type involves selecting typefaces, point sizes, line lengths, line-spacing (leading), and letter-spacing (tracking), as well as adjusting the space between pairs of letters (kerning).

The term typography is also applied to the style, arrangement, and appearance of the letters, numbers, and symbols created by the process. Type design is a closely related craft, sometimes considered part of typography; most typographers do not design typefaces, and some type designers do not consider themselves typographers.

Typography also may be used as an ornamental and decorative device, unrelated to the communication of information. Typography is the work of typesetters (also known as compositors), typographers, graphic designers, art directors, manga artists, comic book artists, and, now, anyone who arranges words, letters, numbers, and symbols for publication, display, or distribution.

Until the Digital Age, typography was a specialized occupation. Digitization opened up typography to new generations of previously unrelated designers and lay users. As the capability to create typography has become ubiquitous, the application of principles and best practices developed over generations of skilled workers and professionals has diminished.`;

export function App() {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const engineRef = useRef<LayoutEngine | null>(null);
    const rendererRef = useRef<CanvasRenderer | null>(null);

    const [status, setStatus] = useState<string>('Initializing...');
    const [statusDot, setStatusDot] = useState<'loading' | 'ok' | 'error'>('loading');
    const [layoutResult, setLayoutResult] = useState<LayoutResult | null>(null);
    const [selection, setSelection] = useState<[number, number] | null>(null);
    const [isDragging, setIsDragging] = useState(false);

    // Controls
    const [columns, setColumns] = useState(2);
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

    // Initialize engine
    useEffect(() => {
        let cancelled = false;

        async function init() {
            try {
                const config = { ...DEFAULT_ENGINE_CONFIG };
                config.frames[0]!.columns = columns;
                config.defaultCharacterStyle = { ...config.defaultCharacterStyle, fontSize };
                config.defaultParagraphStyle = {
                    ...config.defaultParagraphStyle,
                    leading,
                    composer,
                    alignment,
                    tolerance,
                };

                const engine = new LayoutEngine(config);
                engineRef.current = engine;

                setStatus('Loading HarfBuzz WASM...');

                // Download TTF font (HarfBuzz WASM doesn't support WOFF2)
                const fonts = [
                    { family: 'Roboto', url: 'https://raw.githubusercontent.com/googlefonts/roboto/main/src/hinted/Roboto-Regular.ttf', weight: '400', style: 'normal' },
                    { family: 'Roboto', url: 'https://raw.githubusercontent.com/googlefonts/roboto/main/src/hinted/Roboto-Bold.ttf', weight: '700', style: 'normal' },
                    { family: 'Roboto', url: 'https://raw.githubusercontent.com/googlefonts/roboto/main/src/hinted/Roboto-Italic.ttf', weight: '400', style: 'italic' },
                    { family: 'Roboto', url: 'https://raw.githubusercontent.com/googlefonts/roboto/main/src/hinted/Roboto-BoldItalic.ttf', weight: '700', style: 'italic' },
                ];

                await engine.init(fonts);

                if (cancelled) return;

                engine.setText(SAMPLE_TEXT);

                // Add some basic rich text styles just for colored rendering
                engine.story.applyCharacterStyle(0, 10, { color: '#e74c3c' });
                engine.story.applyCharacterStyle(18, 21, { color: '#2980b9' });
                engine.story.applyCharacterStyle(124, 135, { color: '#27ae60' });
                engine.story.applyCharacterStyle(236, 243, { color: '#8e44ad' });
                engine.story.applyCharacterStyle(250, 258, { color: '#e67e22' });

                // Set up renderer
                if (canvasRef.current) {
                    const renderer = new CanvasRenderer(canvasRef.current, {
                        paperWidth: config.paperWidth,
                        paperHeight: config.paperHeight,
                        showColumns,
                        showBaselines,
                    });
                    rendererRef.current = renderer;

                    // Initial layout
                    const result = engine.compose();
                    setLayoutResult(result);
                    renderer.render(
                        result,
                        engine.frameManager.allFrames,
                    );

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

    // Re-compose on config changes
    const recompose = useCallback(() => {
        const engine = engineRef.current;
        const renderer = rendererRef.current;
        if (!engine || !renderer || engine.status.state !== 'ready') return;

        engine.updateConfig({
            frames: [{
                ...DEFAULT_ENGINE_CONFIG.frames[0]!,
                columns,
                columnGap,
            }]
        });

        renderer.updateConfig({ showColumns, showBaselines });

        const result = engine.compose();
        setLayoutResult(result);
        renderer.render(
            result,
            engine.frameManager.allFrames,
            selection
        );

        setStatus(`Ready — ${result.lineCount} lines in ${result.composeTimeMs.toFixed(1)}ms`);
        setStatusDot('ok');
    }, [columns, columnGap, showColumns, showBaselines, selection, fontWeight, fontStyle, color, tracking]);

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

    // Trigger recompose on config change
    useEffect(() => {
        recompose();
    }, [recompose]);

    // Re-render and sync state when selection changes
    useEffect(() => {
        if (rendererRef.current && engineRef.current && layoutResult) {
            rendererRef.current.render(
                layoutResult,
                engineRef.current.frameManager.allFrames,
                selection
            );
        }

        if (engineRef.current && selection) {
            // Sync UI to current cursor position
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
    }, [selection, layoutResult]);

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
                    <select
                        value={composer}
                        onChange={(e) => {
                            const val = e.target.value as ComposerType;
                            setComposer(val);
                            updateStyle('para', { composer: val });
                        }}
                    >
                        <option value="paragraph">Paragraph (Knuth-Plass)</option>
                        <option value="singleLine">Single-Line (Greedy)</option>
                    </select>
                </div>

                {/* Alignment */}
                <div className="control-group">
                    <label className="control-group__label">Alignment</label>
                    <select
                        value={alignment}
                        onChange={(e) => {
                            const val = e.target.value as TextAlignment;
                            setAlignment(val);
                            updateStyle('para', { alignment: val });
                        }}
                    >
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

                    <div className="control-row">
                        <span className="control-row__name">Font Size</span>
                        <span className="control-row__value">{fontSize}px</span>
                    </div>
                    <input
                        type="range"
                        min={8}
                        max={36}
                        step={1}
                        value={fontSize}
                        onChange={(e) => {
                            const val = Number(e.target.value);
                            setFontSize(val);
                            updateStyle('char', { fontSize: val });
                        }}
                    />

                    {/* Rich Text Toggles */}
                    <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                        <button
                            style={{
                                flex: 1,
                                padding: '4px',
                                background: fontWeight > 400 ? 'var(--accent-primary)' : 'var(--bg-surface)',
                                color: fontWeight > 400 ? 'white' : 'var(--text-primary)',
                                border: '1px solid var(--border-subtle)',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                fontWeight: 'bold'
                            }}
                            onClick={() => {
                                const newWeight = fontWeight === 400 ? 700 : 400;
                                setFontWeight(newWeight);
                                updateStyle('char', { fontWeight: newWeight });
                            }}
                        >
                            B
                        </button>
                        <button
                            style={{
                                flex: 1,
                                padding: '4px',
                                background: fontStyle === 'italic' ? 'var(--accent-primary)' : 'var(--bg-surface)',
                                color: fontStyle === 'italic' ? 'white' : 'var(--text-primary)',
                                border: '1px solid var(--border-subtle)',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                fontStyle: 'italic'
                            }}
                            onClick={() => {
                                const newStyle = fontStyle === 'normal' ? 'italic' : 'normal';
                                setFontStyle(newStyle);
                                updateStyle('char', { fontStyle: newStyle });
                            }}
                        >
                            I
                        </button>
                        <input
                            type="color"
                            value={color}
                            style={{ flex: 1, height: '28px', padding: '0', cursor: 'pointer', border: '1px solid var(--border-subtle)', borderRadius: '4px', background: 'var(--bg-surface)' }}
                            onChange={(e) => {
                                setColor(e.target.value);
                                updateStyle('char', { color: e.target.value });
                            }}
                        />
                    </div>

                    <div className="control-row">
                        <span className="control-row__name">Tracking</span>
                        <span className="control-row__value">{tracking.toFixed(2)}em</span>
                    </div>
                    <input
                        type="range"
                        min={-0.1}
                        max={0.5}
                        step={0.01}
                        value={tracking}
                        onChange={(e) => {
                            const val = Number(e.target.value);
                            setTracking(val);
                            updateStyle('char', { tracking: val });
                        }}
                    />

                    <div className="control-row">
                        <span className="control-row__name">Leading</span>
                        <span className="control-row__value">{leading.toFixed(1)}×</span>
                    </div>
                    <input
                        type="range"
                        min={1.0}
                        max={3.0}
                        step={0.1}
                        value={leading}
                        onChange={(e) => {
                            const val = parseFloat(e.target.value);
                            setLeading(val);
                            updateStyle('char', { leading: val });
                        }}
                    />

                    <div className="control-row">
                        <span className="control-row__name">Tolerance</span>
                        <span className="control-row__value">{tolerance}</span>
                    </div>
                    <input
                        type="range"
                        min={1}
                        max={10}
                        step={1}
                        value={tolerance}
                        onChange={(e) => {
                            const val = Number(e.target.value);
                            setTolerance(val);
                            updateStyle('para', { tolerance: val });
                        }}
                    />
                </div>

                {/* Layout */}
                <div className="control-group">
                    <label className="control-group__label">Layout</label>

                    <div className="control-row">
                        <span className="control-row__name">Columns</span>
                        <span className="control-row__value">{columns}</span>
                    </div>
                    <input
                        type="range"
                        min={1}
                        max={6}
                        step={1}
                        value={columns}
                        onChange={(e) => setColumns(Number(e.target.value))}
                    />

                    <div className="control-row">
                        <span className="control-row__name">Column Gap</span>
                        <span className="control-row__value">{columnGap}px</span>
                    </div>
                    <input
                        type="range"
                        min={0}
                        max={60}
                        step={2}
                        value={columnGap}
                        onChange={(e) => setColumnGap(Number(e.target.value))}
                    />
                </div>

                {/* Display */}
                <div className="control-group">
                    <label className="control-group__label">Display</label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                        <input
                            type="checkbox"
                            checked={showColumns}
                            onChange={(e) => setShowColumns(e.target.checked)}
                        />
                        Show column guides
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--text-secondary)', cursor: 'pointer', marginTop: '6px' }}>
                        <input
                            type="checkbox"
                            checked={showBaselines}
                            onChange={(e) => setShowBaselines(e.target.checked)}
                        />
                        Show baselines
                    </label>
                </div>

                {/* Stats */}
                {layoutResult && (
                    <div className="control-group">
                        <label className="control-group__label">Statistics</label>
                        <div className="control-row">
                            <span className="control-row__name">Lines</span>
                            <span className="control-row__value">{layoutResult.lineCount}</span>
                        </div>
                        <div className="control-row">
                            <span className="control-row__name">Glyphs</span>
                            <span className="control-row__value">{layoutResult.glyphCount}</span>
                        </div>
                        <div className="control-row">
                            <span className="control-row__name">Layout Time</span>
                            <span className="control-row__value">{layoutResult.composeTimeMs.toFixed(1)}ms</span>
                        </div>
                    </div>
                )}
            </aside>

            {/* Canvas Area */}
            <main
                className="canvas-area"
                tabIndex={0}
                onKeyDown={(e) => {
                    if (!engineRef.current || !selection) return;

                    const engine = engineRef.current;
                    const story = engine.story;
                    const [s1, s2] = selection;
                    let start = Math.min(s1, s2);
                    let end = Math.max(s1, s2);
                    let hasSelection = start !== end;

                    // Handle Undo / Redo
                    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
                        e.preventDefault();
                        if (e.shiftKey) {
                            story.redo();
                        } else {
                            story.undo();
                        }
                        recompose();
                        return;
                    }

                    // Handle Navigation
                    if (e.key === 'ArrowLeft') {
                        e.preventDefault();
                        if (e.shiftKey) {
                            setSelection([selection[0], Math.max(0, selection[1] - 1)]);
                        } else {
                            const newPos = hasSelection ? start : Math.max(0, start - 1);
                            setSelection([newPos, newPos]);
                        }
                        return;
                    }
                    if (e.key === 'ArrowRight') {
                        e.preventDefault();
                        if (e.shiftKey) {
                            setSelection([selection[0], Math.min(story.length, selection[1] + 1)]);
                        } else {
                            const newPos = hasSelection ? end : Math.min(story.length, end + 1);
                            setSelection([newPos, newPos]);
                        }
                        return;
                    }

                    // Handle Deletion
                    if (e.key === 'Backspace') {
                        e.preventDefault();
                        if (hasSelection) {
                            story.delete(start, end - start);
                            setSelection([start, start]);
                            recompose();
                        } else if (start > 0) {
                            story.delete(start - 1, 1);
                            setSelection([start - 1, start - 1]);
                            recompose();
                        }
                        return;
                    }
                    if (e.key === 'Delete') {
                        e.preventDefault();
                        if (hasSelection) {
                            story.delete(start, end - start);
                            setSelection([start, start]);
                            recompose();
                        } else if (start < story.length) {
                            story.delete(start, 1);
                            setSelection([start, start]);
                            recompose();
                        }
                        return;
                    }

                    // Prevent intercepting hotkeys like Cmd+C, Cmd+V etc.
                    if (e.metaKey || e.ctrlKey || e.altKey) return;

                    // Handle Typing (Printable keys + Enter)
                    if (e.key.length === 1 || e.key === 'Enter') {
                        e.preventDefault();
                        const char = e.key === 'Enter' ? '\n' : e.key;

                        // Replace selection first if exists
                        if (hasSelection) {
                            story.delete(start, end - start);
                        }

                        story.insert(start, char);
                        setSelection([start + 1, start + 1]);
                        recompose();
                    }
                }}
                onPointerDown={(e) => {
                    if (!engineRef.current) return;
                    const rect = canvasRef.current?.getBoundingClientRect();
                    if (!rect) return;
                    const x = e.clientX - rect.left;
                    const y = e.clientY - rect.top;
                    const offset = engineRef.current.hitTest(x, y);
                    if (offset !== -1) {
                        setSelection([offset, offset]);
                        setIsDragging(true);
                        canvasRef.current?.setPointerCapture(e.pointerId);
                    } else {
                        setSelection(null);
                    }
                }}
                onPointerMove={(e) => {
                    if (!isDragging || !engineRef.current || !selection) return;
                    const rect = canvasRef.current?.getBoundingClientRect();
                    if (!rect) return;
                    const x = e.clientX - rect.left;
                    const y = e.clientY - rect.top;
                    const offset = engineRef.current.hitTest(x, y);
                    if (offset !== -1) {
                        setSelection([selection[0], offset]);
                    }
                }}
                onPointerUp={(e) => {
                    setIsDragging(false);
                    try {
                        canvasRef.current?.releasePointerCapture(e.pointerId);
                    } catch (err) { }
                }}
            >
                <canvas ref={canvasRef} style={{ touchAction: 'none' }} />
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
            </footer>
        </div>
    );
}
