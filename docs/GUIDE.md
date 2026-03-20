# Rusty Text Engine - User Guide

## What is Rusty Text Engine?

Rusty Text Engine is a professional-grade web typography engine. It takes text with formatting and produces pixel-perfect layout similar to Adobe InDesign. It features:

- **Knuth-Plass line breaking** - The same optimal algorithm used in TeX/LaTeX
- **HarfBuzz text shaping** - Industry-standard Unicode text shaping via WebAssembly
- **MSDF GPU rendering** - Crisp text at any zoom level using signed distance fields
- **Multi-frame threading** - Text flows across linked frames and columns
- **Polygon text wrapping** - Text wraps around arbitrary shapes
- **IDML document import** - Load InDesign documents in LSXML JSON format
- **Inline tables** - Embed formatted tables within text flow

---

## Getting Started

### Prerequisites

- Node.js 18+
- npm 9+
- A modern browser with WebGL 2 support

### Installation

```bash
git clone <repo-url>
cd rusty-text-engine
npm install
```

### Running the Development Server

```bash
npm run dev
```

Open `http://localhost:5173` in your browser. You will see the main application with:
- A canvas area showing the rendered document
- A sidebar with layout controls
- A text editor panel

### Production Build

```bash
npm run build    # TypeScript check + Vite build
npm run preview  # Preview the production build
```

---

## Application Interface

### Canvas Area

The main canvas shows the rendered text document with two composited layers:
- **WebGL layer** (bottom): GPU-rendered text using MSDF shaders
- **Canvas 2D layer** (top): UI overlays - selection highlighting, frame borders, cursors

**Navigation:**
- Mouse wheel to zoom in/out
- Click and drag to pan
- Click on text to place cursor

### Sidebar Controls

#### Layout Settings
- **Columns**: Number of text columns per frame (1-6)
- **Font Size**: Base font size in points
- **Leading**: Line height multiplier (e.g., 1.2 = 120% of font size)
- **Alignment**: Left, Right, Center, Justify
- **Composer**: "Paragraph" (Knuth-Plass optimal) or "Single Line" (greedy)
- **Tolerance**: Knuth-Plass tolerance (higher = accept looser lines, lower = stricter)

#### Typography Features
- **Optical Margins**: Enable hanging punctuation (quotes, hyphens hang outside margins)
- **Hz-Program**: Enable micro-typographic glyph scaling (subtle width adjustments)

#### IDML Import
- Load an LSXML JSON file to import InDesign documents
- Frames, text, styles, and tables are extracted and rendered

#### Polygon Tool
- Draw polygon exclusion zones on the canvas
- Text wraps around these shapes in real time
- Supports ellipse and freeform polygon creation

### Text Editor

Click on the rendered text to place a cursor, then type to edit. The layout recomposes in real time.

**Style controls:**
- Character styles: bold, italic, underline, strikethrough, color, font size
- Paragraph styles: alignment, indent, spacing

---

## Core Concepts

### Story

A **Story** is the fundamental content unit. It holds:
- Raw text (plain Unicode string)
- Character style spans (font, size, color, weight for ranges of text)
- Paragraph style boundaries (alignment, indents, spacing at paragraph starts)
- Inline objects (tables embedded at U+FFFC placeholder positions)

A story has no knowledge of where or how it will be displayed. Multiple frames can thread the same story.

### Text Frames

A **TextFrame** defines a rectangular or polygonal viewport for text:

| Property | Description |
|----------|-------------|
| `x`, `y` | Position in page coordinates (points) |
| `width`, `height` | Frame dimensions |
| `columns` | Number of text columns |
| `columnGap` | Gap between columns (points) |
| `nextFrameId` | ID of the next frame in the thread |
| `polygon` | Optional polygon vertices for non-rectangular frames |

When text overflows one frame, it continues in the next threaded frame. If text overflows the last frame, it is flagged as **overset**.

### Paragraph Style

Controls paragraph-level formatting:

| Property | Default | Description |
|----------|---------|-------------|
| `alignment` | `'left'` | `'left'`, `'right'`, `'center'`, `'justify'` |
| `leading` | `1.4` | Line height as multiplier of font size |
| `spaceBefore` | `0` | Space above paragraph (points) |
| `spaceAfter` | `8` | Space below paragraph (points) |
| `firstLineIndent` | `0` | First line indent (points, can be negative for hanging) |
| `leftIndent` | `0` | Left indent for all lines (points) |
| `rightIndent` | `0` | Right indent for all lines (points) |
| `composer` | `'paragraph'` | `'paragraph'` (Knuth-Plass) or `'singleLine'` (greedy) |
| `hyphenation` | `false` | Enable automatic hyphenation |
| `tolerance` | `2` | Knuth-Plass tolerance (higher = accept worse breaks) |
| `opticalMargins` | `false` | Enable hanging punctuation |

**Hanging indent example** (bullet lists):
```
leftIndent: 12      // All lines indent 12pt from left
firstLineIndent: -12 // First line goes back 12pt (net: 0 indent)
```
Result: bullet character sits at column edge, continuation text wraps at 12pt indent.

### Character Style

Controls character-level formatting:

| Property | Default | Description |
|----------|---------|-------------|
| `fontFamily` | `'Roboto'` | Font family name |
| `fontSize` | `14` | Font size in points |
| `fontWeight` | `400` | Weight (400=regular, 700=bold) |
| `fontStyle` | `'normal'` | `'normal'` or `'italic'` |
| `color` | `'#1a1a2e'` | Text color (CSS hex) |
| `tracking` | `0` | Letter spacing in em units |
| `leading` | undefined | Per-run leading override (multiplier) |
| `baselineShift` | undefined | Vertical shift in points (positive=up) |
| `underline` | `false` | Underline decoration |
| `strikethrough` | `false` | Strikethrough decoration |

---

## Knuth-Plass Line Breaking

The engine uses the Knuth-Plass algorithm for optimal paragraph composition. Unlike greedy line breaking (which makes locally optimal decisions), Knuth-Plass considers the entire paragraph to find the globally optimal set of line breaks.

### How It Works

1. Text is converted to a stream of **Box**, **Glue**, and **Penalty** elements:
   - **Box**: A word or glyph cluster with a fixed width
   - **Glue**: A space that can stretch or shrink (has natural width, stretch amount, shrink amount)
   - **Penalty**: A potential break point with a cost (high cost = avoid breaking here)

2. The algorithm uses dynamic programming to find the set of breaks that minimizes total **demerits** (badness) across the entire paragraph.

3. **Demerits** are based on:
   - How much glue must stretch/shrink to fill each line
   - Penalty values at each break point
   - Consecutive hyphens (penalized)
   - Adjacent lines with very different tightness (penalized)

### Adjustment Ratio

Each line has an **adjustment ratio** that determines how glue is scaled:
- `ratio = 0`: Line naturally fills the target width
- `ratio > 0`: Glue stretches (loose line)
- `ratio < 0`: Glue shrinks (tight line)
- `ratio < -1`: Line is too tight (infeasible - break is rejected)

### Tolerance

The **tolerance** parameter controls how strict the algorithm is:
- `tolerance = 1`: Very strict - only accepts well-fitting lines
- `tolerance = 2`: Default - good balance
- `tolerance = 5+`: Very loose - accepts poor fits (useful for narrow columns)

If no solution is found at the given tolerance, the algorithm retries with doubled tolerance, then falls back to greedy.

---

## IDML Document Import

The engine can import InDesign documents in LSXML JSON format.

### LSXML JSON Format

The LSXML format is a JSON representation of IDML (InDesign Markup Language):

```json
{
  "LSXML": {
    "StoryXML": {
      "Story": [
        {
          "Id": "u9ea",
          "Paragraph_Styles": [
            {
              "paragraph_id": "para_000",
              "Alignment": "LeftAlign",
              "PointSize": "9",
              "Leading": "10.8",
              "LeftIndent": "11.3386",
              "FirstLineIndent": "-11.3386",
              "SpaceBefore": "0",
              "SpaceAfter": "0",
              "content": [
                {
                  "text": "- Keep this leaflet.",
                  "line_break": "true",
                  "FontStyle": "Regular",
                  "PointSize": "9"
                }
              ]
            }
          ]
        }
      ]
    },
    "Page_Meta": {
      "Layout": {
        "Spread": [...]
      },
      "Styles": {
        "Graphic": {
          "Color": [...]
        }
      }
    }
  }
}
```

### Import Pipeline

1. **Load JSON**: The LSXML JSON file is loaded (e.g., from a file input or fetch)
2. **Parse**: `parseLSXMLJson(json)` extracts:
   - Page dimensions (width, height in points)
   - Text frames with geometry, columns, threading
   - Stories with full text + character/paragraph style spans
   - Inline tables with cell data and formatting
   - Graphic lines (rules, borders)
3. **Apply to engine**:
   - Frame configurations set via `engine.updateConfig()`
   - Story text set via `engine.setText()`
   - Character styles applied via `story.applyCharacterStyle()`
   - Paragraph styles applied via `story.applyParagraphStyle()`
   - Tables registered via `story.registerInlineObject()`
4. **Compose & render**: Standard pipeline produces the layout

### LSXML Content Item Rules

Each paragraph's `content` array contains items with `text` and `line_break` fields:

| `line_break` | `text` | Meaning |
|-------------|--------|---------|
| `"true"` | `"actual content"` | Text followed by a line break (forced return) |
| `"false"` | `"\n"` | Export artifact - newline is **stripped** |
| `"false"` | `"actual content"` | Text content (no line break appended) |

The `\n` characters in `line_break: "false"` items are LSXML formatting artifacts. Actual paragraph breaks come from `line_break: "true"` on the preceding text item, plus the paragraph structure itself.

### Supported IDML Features

| Feature | Support |
|---------|---------|
| Text frames with threading | Full |
| Multi-column frames | Full |
| Character styles (font, size, weight, color, tracking) | Full |
| Paragraph styles (alignment, indent, spacing) | Full |
| Superscript / Subscript | Full (via Position attribute) |
| Underline / Strikethrough | Full |
| Baseline shift | Full |
| Horizontal scaling | Converted to tracking |
| CMYK / RGB colors | Full (with tint support) |
| Inline tables | Full (row/column spans, cell styling) |
| Polygon frames | Full |
| Graphic lines | Full |
| Kerning (optical/metrics) | Partial (uses HarfBuzz default) |
| Hyphenation | Basic (via TextSegmenter) |
| Tab stops | Not yet implemented |
| Nested styles / GREP styles | Not yet implemented |
| Images / anchored objects | Not yet implemented |
| Master pages | Not yet implemented |

---

## Polygon Text Wrapping

Text can wrap around arbitrary polygon shapes. Two types:

### Frame Polygons

The frame itself can be a polygon (non-rectangular). Text only flows within the polygon boundary:

```typescript
const frame = new TextFrame({
    id: 'poly-frame',
    x: 0, y: 0, width: 400, height: 400,
    polygon: [
        { x: 200, y: 0 },   // top center
        { x: 400, y: 300 },  // right
        { x: 0, y: 300 },    // left
    ],
});
```

### Wrap Exclusion Objects

Objects placed on the page that text flows around:

```typescript
engine.updateConfig({
    wrapObjects: [
        {
            type: 'polygon',
            vertices: makeEllipsePolygon(200, 300, 80, 80, 32),
        },
    ],
});
```

The `ScanlineEngine` computes available horizontal intervals at each line's Y position by intersecting the frame boundary with exclusion polygons.

---

## Inline Tables

Tables can be embedded within the text flow:

```typescript
import { Table } from './core/Table';

const table = new Table({
    rows: 3,
    cols: 4,
    columnWidths: [100, 100, 100, 100],
    style: getTablePresetStyle('headerStriped'),
});

table.setCell(0, 0, "Header 1");
table.setCell(0, 1, "Header 2");
// ...

story.insertInlineObject(offset, table);
```

Tables support:
- Per-cell styling (padding, fill, stroke, vertical alignment)
- Row/column merge and split
- Dynamic or fixed row heights
- Multiple visual presets

---

## Rendering Pipeline

### MSDF (Multi-channel Signed Distance Field)

The engine generates MSDF texture atlases for each font weight:

1. **Atlas generation**: `MSDFAtlasGenerator` processes font glyphs into a packed texture
2. **Texture upload**: Atlas uploaded to GPU via `WebGLRenderer.setAtlas()`
3. **Instanced rendering**: Each glyph is a textured quad; all glyphs drawn in one draw call
4. **Fragment shader**: Samples MSDF texture, computes edge distance, applies anti-aliasing

Benefits:
- Resolution-independent (sharp at any zoom)
- Single draw call for thousands of glyphs
- Smooth anti-aliasing without font rasterization

### Fallback Rendering

If WebGL 2 is unavailable, `NullGPURenderer` is used and `CanvasRenderer` draws text directly using the Canvas 2D `fillText()` API.

---

## Programmatic Usage

### Basic Layout

```typescript
import { LayoutEngine, DEFAULT_ENGINE_CONFIG } from './layout/LayoutEngine';

const engine = new LayoutEngine(DEFAULT_ENGINE_CONFIG);
await engine.init([
    { family: 'Roboto', url: '/fonts/Roboto-Regular.ttf', weight: '400', style: 'normal' },
    { family: 'Roboto', url: '/fonts/Roboto-Bold.ttf', weight: '700', style: 'normal' },
]);

engine.setText("Your text content here...");

// Apply styles
engine.story.applyCharacterStyle(0, 4, { fontWeight: 700, fontSize: 18 });
engine.story.applyParagraphStyle(0, 100, { alignment: 'justify' });

// Compose
const result = engine.compose();
// result.glyphs: PositionedGlyph[] — ready for rendering
// result.lineCount, result.glyphCount — statistics
```

### Multi-Frame Layout

```typescript
engine.updateConfig({
    frames: [
        { id: 'f1', x: 50, y: 50, width: 300, height: 400, columns: 1, columnGap: 0, nextFrameId: 'f2' },
        { id: 'f2', x: 400, y: 50, width: 300, height: 400, columns: 1, columnGap: 0 },
    ],
});
```

### IDML Import

```typescript
import { parseLSXMLJson } from './idml/JSONParser';

const response = await fetch('/path/to/document.json');
const json = await response.json();
const doc = parseLSXMLJson(json);

// Apply to engine
const mainStory = doc.stories[doc.mainStoryId];
engine.updateConfig({
    frames: doc.frames.map(f => ({
        id: f.id, x: f.x, y: f.y, width: f.width, height: f.height,
        columns: f.columns, columnGap: f.columnGap,
        nextFrameId: f.nextFrameId ?? undefined,
        polygon: f.polygon,
    })),
});

engine.setText(mainStory.text);

for (const span of mainStory.charSpans) {
    engine.story.applyCharacterStyle(span.start, span.end, span.style);
}
for (const span of mainStory.paraSpans) {
    engine.story.applyParagraphStyle(span.start, span.end, span.style);
}

const result = engine.compose();
```

---

## Performance Notes

- **Paragraph-level caching**: Shaped paragraphs are cached. Only changed paragraphs are re-shaped on edits.
- **Per-paragraph processing**: Knuth-Plass runs per paragraph (not whole document) to limit O(n^2) cost.
- **Instanced GPU rendering**: Thousands of glyphs rendered in a single draw call.
- **Web Worker atlas generation**: MSDF atlas computation runs off the main thread.
- **Greedy fallback**: If Knuth-Plass fails (e.g., extremely narrow column), greedy composer ensures output.

---

## Troubleshooting

### Text appears blurry
- Ensure the MSDF atlas has been generated with sufficient texture size (1024x1024 or larger)
- Check that the WebGL renderer is active (not falling back to Canvas 2D)

### Text overflows frames
- Check the `overset` flag on the last frame
- Add more frames to the thread or increase frame dimensions
- Reduce font size or leading

### IDML import shows wrong layout
- Verify the LSXML JSON matches the expected structure
- Check that font families referenced in the document are loaded (fallback is Roboto)
- Frame coordinates are in points (1 pt = 1/72 inch)

### Ligatures not rendering
- Ligatures (`fi`, `fl`, `ff`) are intentionally disabled in HarfBuzz to ensure individual glyph rendering for MSDF atlas compatibility
- This is by design for correct MSDF rendering

### SharedArrayBuffer errors
- The Vite dev server sets required CORS headers automatically
- For production, ensure your server sends:
  - `Cross-Origin-Opener-Policy: same-origin`
  - `Cross-Origin-Embedder-Policy: require-corp`
