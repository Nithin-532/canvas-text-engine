# Rusty Text Engine - Architecture & Code Structure

## Overview

Rusty Text Engine is a web-based professional typography engine that implements the Knuth-Plass line-breaking algorithm with MSDF (Multi-channel Signed Distance Field) GPU rendering, polygon-based text wrapping, and InDesign IDML document import. Built with TypeScript, React, and WebGL 2.

---

## Project Structure

```
src/
├── types.ts                          # Shared type definitions & defaults
├── vite-env.d.ts                     # WASM/HarfBuzz type declarations
├── main.tsx                          # React DOM root entry point
│
├── ui/
│   └── App.tsx                       # Main React application shell
│
├── core/
│   ├── Story.ts                      # Content model (text + styles)
│   ├── TextFrame.ts                  # Frame geometry & FrameManager
│   └── Table.ts                      # Inline table object
│
├── shaping/
│   ├── ShapingPipeline.ts            # Shaping orchestrator
│   ├── FontManager.ts                # HarfBuzz WASM + font management
│   ├── harfbuzz.ts                   # Low-level HarfBuzz C API bindings
│   ├── Itemizer.ts                   # Text run decomposition
│   └── TextSegmenter.ts             # Unicode break opportunity detection
│
├── layout/
│   ├── LayoutEngine.ts               # Top-level composition orchestrator
│   ├── KnuthPlassElements.ts         # Box/Glue/Penalty element builder
│   ├── ParagraphComposer.ts          # Knuth-Plass & Greedy line breakers
│   ├── ColumnFlowManager.ts          # Multi-frame column distribution
│   ├── OpticalMargins.ts             # Hanging punctuation tables
│   └── GlyphScaler.ts               # Hz-program glyph scaling
│
├── renderer/
│   ├── CanvasRenderer.ts             # Canvas 2D rendering + UI overlays
│   ├── WebGLRenderer.ts              # WebGL 2 MSDF glyph rendering
│   ├── WebGPURenderer.ts             # WebGPU backend (stub)
│   ├── MSDFAtlasGenerator.ts         # MSDF texture atlas generation
│   ├── NullGPURenderer.ts            # No-op GPU fallback
│   ├── GPURendererInterface.ts       # GPU renderer interface contract
│   └── shaders/
│       ├── msdf.vert                 # MSDF vertex shader (GLSL)
│       └── msdf.frag                 # MSDF fragment shader (GLSL)
│
├── geometry/
│   ├── Polygon.ts                    # Geometric primitives & operations
│   ├── ScanlineEngine.ts             # Scanline interval computation
│   └── BentleyOttmann.ts             # Active segment sweep structure
│
└── idml/
    └── JSONParser.ts                 # LSXML/IDML JSON document parser
```

---

## Core Architecture

The engine follows a **pipeline architecture** with clearly separated concerns:

```
   Story (content)
       │
       ▼
   ShapingPipeline ──► HarfBuzz WASM
       │
       ▼
   KnuthPlassElements (Box/Glue/Penalty)
       │
       ▼
   ParagraphComposer (Knuth-Plass DP)
       │
       ▼
   ColumnFlowManager (frame threading)
       │
       ▼
   PositionedGlyph[] (final output)
       │
       ├──► WebGLRenderer (MSDF GPU)
       └──► CanvasRenderer (2D overlays)
```

### Design Pattern: Story-View Separation

The engine separates **content** from **geometry**:

- **Story** (`src/core/Story.ts`) holds pure text, character styles, and paragraph styles. It has zero awareness of frames, columns, or layout.
- **TextFrame** (`src/core/TextFrame.ts`) defines rectangular or polygonal viewports. Multiple frames can thread a single story for multi-column/multi-frame layouts.
- **LayoutEngine** (`src/layout/LayoutEngine.ts`) bridges these: it reads the Story, shapes text, breaks lines, and distributes them across frames.

---

## Module Documentation

### `src/types.ts` - Type Definitions

Single source of truth for all shared types. Key type groups:

| Group | Types | Purpose |
|-------|-------|---------|
| **Shaping** | `ShapedGlyph`, `ShapedRun`, `ShapedParagraph` | Text shaping output |
| **Breaking** | `BreakOpportunity`, `BreakType` | Line-break decisions |
| **Knuth-Plass** | `BoxElement`, `GlueElement`, `PenaltyElement` | Algorithm elements |
| **Composition** | `LineBreak`, `ComposedLine` | Line breaking results |
| **Rendering** | `PositionedGlyph`, `ColumnLayout`, `FrameLayout`, `LayoutResult` | Final render data |
| **Styles** | `ParagraphStyle`, `CharacterStyle`, `TextAlignment` | Typography formatting |
| **Config** | `TextFrameConfig`, `EngineConfig` | Document structure |
| **Geometry** | `WrapObject` | Polygon exclusion zones |
| **Tables** | `CellStyle`, `TableStyle`, `CellSpan`, `RowHeightMode` | Table formatting |

Default objects: `DEFAULT_PARAGRAPH_STYLE`, `DEFAULT_CHARACTER_STYLE`, `DEFAULT_ENGINE_CONFIG`

### `src/core/Story.ts` - Content Model

The `Story` class is the content backbone:

```typescript
const story = new Story("Hello world", defaultCharStyle, defaultParaStyle);

// Edit operations
story.insert(5, " beautiful");
story.delete(0, 5);

// Style application
story.applyCharacterStyle(0, 10, { fontWeight: 700, color: '#e74c3c' });
story.applyParagraphStyle(0, 50, { alignment: 'justify', leftIndent: 12 });

// Query
const paras = story.getParagraphs();       // { text, startOffset, style }[]
const style = story.getCharacterStyleAt(5); // merged CharacterStyle
const pstyle = story.getParagraphStyleAt(0); // resolved ParagraphStyle

// Inline objects (tables, images)
story.insertInlineObject(offset, tableInstance); // inserts U+FFFC placeholder

// Change tracking
story.addEventListener((story) => { /* re-compose */ });
```

**Key internals:**
- `_text: string` - raw content
- `_styleSpans: StyleSpan[]` - character style ranges `{ start, end, style }`
- `_paragraphBoundaries: ParagraphBoundary[]` - paragraph breaks with styles
- `_inlineObjects: Map<number, InlineObject>` - embedded objects at U+FFFC positions
- `_undoStack` / `_redoStack` - edit history for undo/redo

### `src/core/TextFrame.ts` - Frame Geometry

Defines rectangular or polygonal text containers:

```typescript
const frame = new TextFrame({
    id: 'frame-1',
    x: 50, y: 50, width: 400, height: 600,
    columns: 2, columnGap: 12,
    nextFrameId: 'frame-2',  // threading
});

const cols = frame.getColumnGeometries(); // [{ x, y, width, height }, ...]
const colWidth = frame.getColumnWidth();
```

**FrameManager** manages the frame graph, providing thread traversal and geometry queries.

### `src/core/Table.ts` - Inline Tables

Full InDesign-quality table implementation embedded via U+FFFC:

- Per-cell styling (padding, fill, stroke, vertical alignment)
- Row/column operations (add, delete, merge, split)
- Multiple height modes: `'atLeast'` (dynamic) and `'exactly'` (fixed)
- Presets: `'plain'`, `'striped'`, `'headerStriped'`, `'darkHeader'`, `'columnStriped'`
- Keyboard navigation and cell selection
- Import/export: CSV, JSON, HTML

---

### `src/shaping/` - Text Shaping Pipeline

#### ShapingPipeline.ts - Orchestrator

Coordinates the full shaping flow for a Story:

```
Story.getParagraphs()
    │
    ├── TextSegmenter.findBreakOpportunities(text)  → BreakOpportunity[]
    ├── Itemizer.itemize(text, offset, story)        → TextRun[]
    └── FontManager.shape(run)                       → ShapedGlyph[]
    │
    ▼
ShapedParagraph { runs, breakOpportunities, text, paragraphStyle }
```

#### FontManager.ts - Font & HarfBuzz Management

Manages HarfBuzz WASM initialization and font loading:

```typescript
const fm = new FontManager();
await fm.init();  // loads HarfBuzz WASM

await fm.loadFontFromUrl('Roboto', 'path/to/Roboto-Regular.ttf', '400', 'normal');
await fm.loadFontFromUrl('Roboto', 'path/to/Roboto-Bold.ttf', '700', 'normal');

const glyphs = fm.shape("Hello", 14, 'Roboto', 400, 'normal');
const px = fm.fontUnitsToPixels(500, 14, 'Roboto');
```

**Font lookup** uses composite key `family-weight-style` with fallback chain.

#### harfbuzz.ts - Low-Level WASM Bindings

Direct interface to the HarfBuzz C library compiled to WebAssembly:

- `HarfBuzzBlob` - allocates font data in WASM heap
- `HarfBuzzFace` - creates `hb_face_t` from blob
- `HarfBuzzFont` - creates `hb_font_t` with sizing
- `HarfBuzzBuffer` - text buffer for shaping

**Ligature handling:** `liga` and `clig` OpenType features are explicitly disabled via `hb_feature_t` structs to prevent ligature rendering issues with MSDF atlas (individual glyph rendering).

#### Itemizer.ts - Run Decomposition

Splits text into uniform runs based on:
- Character style changes (font, size, weight, color)
- Script detection (Latin, Arabic, Devanagari, CJK, etc.)
- Direction detection (LTR / RTL)
- Inline objects (U+FFFC boundaries)

#### TextSegmenter.ts - Break Opportunities

Finds legal line-break positions using:
- `Intl.Segmenter` with word granularity
- Mandatory breaks: LF, CR, U+2028 (line separator), U+2029 (paragraph separator)
- Soft hyphens (U+00AD)

**Penalty constants:**
| Constant | Value | Meaning |
|----------|-------|---------|
| `PENALTY_WORD` | 0 | Normal word boundary |
| `PENALTY_HYPHEN` | 50 | Discouraged but allowed |
| `PENALTY_NEVER` | 10000 | Forbidden break |
| `PENALTY_FORCED` | -10000 | Mandatory break |

---

### `src/layout/` - Layout & Composition

#### LayoutEngine.ts - Top-Level Orchestrator

The main entry point for the entire layout pipeline:

```typescript
const engine = new LayoutEngine(config);
await engine.init([
    { family: 'Roboto', url: '...', weight: '400', style: 'normal' },
    { family: 'Roboto', url: '...', weight: '700', style: 'normal' },
]);

engine.setText("Lorem ipsum dolor sit amet...");
engine.story.applyCharacterStyle(0, 5, { fontWeight: 700 });

const result = engine.compose();
// result: { frames, glyphs, composeTimeMs, lineCount, glyphCount }
```

**Pipeline steps in `compose()`:**
1. **Shape** - `ShapingPipeline.shapeStory(story)` with paragraph-level caching
2. **Build elements** - `buildElements()` converts shaped glyphs to Box/Glue/Penalty
3. **Break lines** - `ParagraphComposer.compose()` (Knuth-Plass) or `GreedyComposer` fallback
4. **Distribute** - `ColumnFlowManager.distribute()` places lines across frames/columns
5. **Position glyphs** - Final `PositionedGlyph[]` with absolute coordinates

**Caching:** Shaped paragraphs are cached by a composite key of text content + paragraph style properties + story version. Cache is invalidated when any component changes.

#### KnuthPlassElements.ts - Element Builder

Converts `ShapedParagraph` into a stream of Knuth-Plass elements:

```
"Hello world" → [Box("Hello"), Glue(" "), Box("world"), Penalty(forced)]
```

- **Box** - word/glyph cluster with fixed width, carries `ShapedGlyph[]` for rendering
- **Glue** - space with `width` (natural), `stretch` (max expansion), `shrink` (max compression)
- **Penalty** - potential break point with cost; `flagged = true` for hyphens

Glue stretch/shrink values are calibrated for professional typography:
- `stretch = spaceWidth * 0.5` (can grow 50%)
- `shrink = spaceWidth * 0.333` (can shrink 33%)

#### ParagraphComposer.ts - Line Breaking

Two composers:

**ParagraphComposer** (Knuth-Plass algorithm):
- Dynamic programming over all feasible breakpoints
- Active node list with pruning of infeasible breaks
- Demerits based on: line badness (ratio^3), penalty cost, fitness class transitions, consecutive hyphens
- Supports variable line widths (polygon wrapping)
- Falls back to greedy if no solution found within tolerance

**GreedyComposer**:
- Simple left-to-right fill
- Breaks at the last legal break opportunity before overflow
- Handles polygon-occluded lines by peeking ahead for wider slots
- Always produces output (no failure mode)

Both composers accept `lineWidth: number | ((lineNumber: number) => number)` for per-line width variation.

#### ColumnFlowManager.ts - Frame Distribution

Distributes composed lines across the frame threading chain:

1. **buildLineWidthsForParagraph()** - Pre-computes available width at each line position considering frame geometry, column layout, and wrap polygon exclusions
2. **buildComposedLines()** - Creates `ComposedLine[]` from break results with line height, alignment, indent info
3. **distribute()** - Places lines into frames/columns, handling:
   - Frame threading (follow `nextFrameId` chain)
   - Column progression within frames
   - Polygon wrap exclusion via `ScanlineEngine`
   - Alignment offsets (left, right, center, justify)
   - Left/right/first-line indent offsets
   - Optical margins (hanging punctuation)
   - Overset detection (text overflow)

**Glyph positioning** applies:
- Alignment offset (right/center/justify)
- Left indent (paragraph indent + first-line indent for line 0)
- Glue adjustment (stretch/shrink based on ratio)
- Baseline shift
- Optical margin outdent

#### OpticalMargins.ts - Hanging Punctuation

Implements Adobe InDesign-style optical margin alignment:

Characters with outdent fractions (portion of glyph width that hangs outside):
- Quotes: `"`, `'`, opening/closing variants — 60-100% outdent
- Hyphens/dashes: `-`, `--`, `---` — 50-70% outdent
- Terminals: `.`, `,` — 60-80% outdent
- Brackets: `(`, `)`, `[`, `]` — 5% outdent

#### GlyphScaler.ts - Hz-Program

Hermann Zapf's hz-program for micro-typographic glyph width adjustment:
- Only applied when Knuth-Plass adjustment ratio exceeds threshold (|ratio| > 0.5)
- Scales glyph widths within configurable bounds (default: 97%-103%)
- Improves line fit without visible distortion

---

### `src/renderer/` - Rendering System

The engine uses a **dual-layer rendering** approach:

```
┌─────────────────────────────┐
│   Canvas 2D Layer (top)     │  ← UI overlays, selection, debug
│   ┌─────────────────────┐   │
│   │  WebGL 2 Layer      │   │  ← MSDF glyph rendering
│   │  (composited via    │   │
│   │   drawImage)        │   │
│   └─────────────────────┘   │
└─────────────────────────────┘
```

#### WebGLRenderer.ts - GPU Text Rendering

High-performance MSDF glyph rendering via WebGL 2:

- **Instanced rendering**: Single draw call renders thousands of glyphs
- **Per-instance data**: position (x, y), size (w, h), UV coordinates, RGBA color
- **MSDF shader**: Samples multi-channel distance field for crisp text at any zoom level
- **Dual atlas**: Separate atlases for regular and bold weights (fontWeight >= 700)
- **Transform**: Uniform-based zoom/pan for interactive navigation

**Shader pipeline:**
- Vertex shader: transforms quad vertices + instance data to screen space
- Fragment shader: MSDF median-of-three + smoothstep for anti-aliased edges

#### CanvasRenderer.ts - 2D Overlays

Canvas 2D renderer for UI elements and fallback text:

- Frame outlines and column boundaries
- Baseline guides
- Glyph bounding boxes (debug)
- Text selection highlighting
- Wrap object visualization
- Cursor positioning
- Hit testing: `hitTest(x, y)` returns the glyph under a point

#### MSDFAtlasGenerator.ts - Atlas Generation

Generates MSDF texture atlases from font files:

```typescript
const gen = new MSDFAtlasGenerator();
await gen.init();

const atlas = await gen.generateAtlas(
    fontData,           // TTF/OTF ArrayBuffer
    "ABCDEFGHabc...",   // charset string
    4,                  // field range (SDF edge width)
    [1024, 1024]        // texture dimensions
);
// atlas: { data: ImageData, metrics: { [glyphId]: GlyphMetrics } }
```

Runs in a Web Worker via `@zappar/msdf-generator` WASM to avoid blocking the main thread.

#### NullGPURenderer.ts - Fallback

No-op implementation of `IGPURenderer` for browsers without WebGL 2. When active, `CanvasRenderer` renders text directly with `drawText: true`.

---

### `src/geometry/` - Geometric Operations

#### Polygon.ts - Core Primitives

Provides geometric operations for polygon-based text wrapping:

- `polygonXIntersections(poly, scanY)` - All X coordinates where polygon edges cross a horizontal scanline
- `intersectionsToIntervals(xs)` - Pairs intersections into [enter, exit] intervals
- `subtractIntervals(a, b)` - Set subtraction for wrap exclusions
- `pointInPolygon(point, poly)` - Even-odd ray casting test
- `makeEllipsePolygon(cx, cy, rx, ry, n)` - Factory for ellipse boundaries

#### ScanlineEngine.ts - Interval Computation

Computes available text intervals at a given Y band:

1. Samples at top, middle, and bottom of the line band
2. For each sample: computes frame polygon intervals, subtracts exclusion polygons
3. Returns the intersection (narrowest) across all samples

**Fast path:** `getRectIntervals()` for rectangular frames (no polygon intersection needed).

#### BentleyOttmann.ts - Segment Management

Efficient active-segment lookup for complex polygons with many edges. Pre-sorts segments by Y range for O(n) lookup at any scanline.

---

### `src/idml/` - IDML Document Import

#### JSONParser.ts - LSXML JSON Parser

Parses IDML documents in LSXML JSON format:

```typescript
import { parseLSXMLJson } from './idml/JSONParser';

const doc = parseLSXMLJson(jsonData);
// doc.pageWidth, doc.pageHeight    — document dimensions (points)
// doc.frames[]                     — text frame geometry
// doc.stories                      — { [storyId]: IDMLStory }
// doc.mainStoryId                  — primary story ID
// doc.graphicLines?[]              — non-text graphic elements
```

**LSXML structure parsed:**
- `LSXML.StoryXML.Story[]` - text content with character/paragraph styles
- `LSXML.Page_Meta.Layout.Spread[]` - pages, frames, transforms
- `LSXML.Page_Meta.Styles.Graphic.Color[]` - CMYK/RGB color swatches

**Style extraction:**
- Character styles: font family/style/size, color, tracking, baseline shift, underline, strikethrough, superscript/subscript, horizontal scaling
- Paragraph styles: alignment, leading, space before/after, first line indent, left/right indent, composer type
- Color resolution: named colors, inline CMYK/RGB, tint percentages

**LSXML `\n` handling:**
Content items with `line_break: "false"` and `text: "\n"` are LSXML export artifacts — their newlines are stripped. Actual line breaks come from items with `line_break: "true"`.

**Table parsing:**
Inline tables are detected, parsed into `Table` instances, and embedded at U+FFFC positions in the story text.

---

## Data Flow

### Full Composition Pipeline

```
1. INPUT
   ├── Story.text (string)
   ├── Story.styleSpans (CharacterStyle ranges)
   ├── Story.paragraphBoundaries (ParagraphStyle per paragraph)
   └── EngineConfig (frames, defaults)

2. SHAPING (per paragraph)
   ├── TextSegmenter → BreakOpportunity[]
   ├── Itemizer → TextRun[] (uniform style/script/direction)
   └── HarfBuzz → ShapedGlyph[] (glyph IDs, advances, offsets)
   ──► ShapedParagraph

3. ELEMENT BUILDING
   └── buildElements(ShapedParagraph) → KnuthPlassElement[]
       (Box for words, Glue for spaces, Penalty at break points)

4. LINE BREAKING
   ├── ParagraphComposer (Knuth-Plass DP)
   │   └── lineWidthFn(n) accounts for leftIndent, rightIndent, firstLineIndent
   └── GreedyComposer (fallback)
   ──► LineBreak[] (break positions + adjustment ratios)

5. LINE BUILDING
   └── buildComposedLines(elements, breaks, paraStyle)
       ──► ComposedLine[] with lineHeight, alignment, indent

6. DISTRIBUTION
   └── distribute(lines, frameManager, startFrameId)
       ├── Thread frames via nextFrameId chain
       ├── Fill columns top-to-bottom
       ├── ScanlineEngine for polygon wrap exclusions
       ├── Apply indent + alignment offsets
       └── Position each glyph with absolute (x, y)
   ──► PositionedGlyph[]

7. RENDERING
   ├── WebGLRenderer.render(glyphs, atlas) → GPU MSDF quads
   └── CanvasRenderer.render(result, frames, selection) → 2D overlays
```

### IDML Import Flow

```
1. Load idml.json (LSXML format)
2. parseLSXMLJson(json) → IDMLDocument
3. Extract frames → engine.updateConfig({ frames })
4. Extract main story text → engine.setText(text)
5. Apply charSpans → story.applyCharacterStyle(start, end, style)
6. Apply paraSpans → story.applyParagraphStyle(start, end, style)
7. Register inline tables → story.registerInlineObject(offset, table)
8. engine.compose() → LayoutResult
9. Render
```

---

## Key Algorithms

### Knuth-Plass Line Breaking

See `CLAUDE.md` for the complete algorithm description. Key points:

- **Elements**: Box (fixed-width content), Glue (stretchable space), Penalty (break cost)
- **Optimization**: Minimizes total demerits across the entire paragraph
- **Demerits**: Based on adjustment ratio (how much glue stretches/shrinks) + penalty values
- **Active list**: Maintains feasible breakpoints, prunes when ratio < -1
- **Fitness classes**: 4 classes (tight/normal/loose/very-loose) with transition penalties
- **Complexity**: O(n^2) worst case; paragraphs processed individually to limit n

### MSDF Rendering

Multi-channel Signed Distance Fields encode distance-to-edge in RGB channels:
- Each channel stores distance to a different edge contour
- Fragment shader takes median of 3 channels for the true distance
- `smoothstep` converts distance to opacity for anti-aliased edges
- Resolution-independent: sharp at any zoom level

### Scanline Text Wrapping

For polygon frames or wrap exclusion objects:
1. At each potential line Y position, cast horizontal scanline
2. Find all polygon edge intersections
3. Pair intersections into [enter, exit] intervals (available space)
4. Subtract exclusion polygon intervals from frame polygon intervals
5. Return widest remaining interval as the line width

---

## Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `react` | 19.x | UI framework |
| `react-dom` | 19.x | React DOM rendering |
| `harfbuzzjs` | 0.8.0 | Text shaping (WASM) |
| `@zappar/msdf-generator` | 1.2.4 | MSDF atlas generation (WASM) |
| `opentype.js` | 1.3.4 | Glyph path extraction |
| `potpack` | 2.1.0 | Rectangle bin packing (atlas layout) |
| `fflate` | 0.8.2 | ZIP decompression (IDML import) |

### Dev Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `typescript` | 5.7.x | Type checking |
| `vite` | 6.1.x | Dev server + bundler |
| `@vitejs/plugin-react` | 4.x | React HMR |
| `eslint` | 9.x | Linting |

---

## Build & Development

```bash
# Install dependencies
npm install

# Start development server (hot reload)
npm run dev
# → http://localhost:5173

# Type-check + production build
npm run build

# Preview production build
npm run preview
```

### Vite Configuration

- **CORS headers**: `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` for `SharedArrayBuffer` support (HarfBuzz WASM)
- **WASM assets**: Included in build output
- **Web Workers**: ES module format
- **HarfBuzz**: Excluded from dependency pre-bundling (loaded as WASM)
