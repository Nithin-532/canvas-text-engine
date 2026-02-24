import fs from 'fs';
const buf = fs.readFileSync('node_modules/harfbuzzjs/hb.wasm');
WebAssembly.compile(buf).then(mod => {
    let wasmExports = null;
    WebAssembly.instantiate(mod, {
        wasi_snapshot_preview1: { proc_exit: () => { } },
        env: {
            _emscripten_runtime_keepalive_clear: () => { },
            _abort_js: () => { },
            _setitimer_js: () => { },
            emscripten_resize_heap: (requestedSize) => {
                const memory = wasmExports.memory;
                const oldPages = memory.buffer.byteLength / 65536;
                const newPages = Math.ceil(requestedSize / 65536);
                try { memory.grow(newPages - oldPages); return 1; } catch (e) { return 0; }
            }
        }
    }).then(instance => {
        wasmExports = instance.exports;

        // Minimal mock of HarfBuzzExports
        const hb = {
            malloc: wasmExports.malloc,
            free: wasmExports.free,
            heapu8: new Uint8Array(wasmExports.memory.buffer),
            heapu32: new Uint32Array(wasmExports.memory.buffer),
            heapi32: new Int32Array(wasmExports.memory.buffer),
            hb_blob_create: wasmExports.hb_blob_create,
            hb_face_create: wasmExports.hb_face_create,
            hb_font_create: wasmExports.hb_font_create,
            hb_buffer_create: wasmExports.hb_buffer_create,
            hb_buffer_add_utf8: wasmExports.hb_buffer_add_utf8,
            hb_buffer_guess_segment_properties: wasmExports.hb_buffer_guess_segment_properties,
            hb_shape: wasmExports.hb_shape,
            hb_buffer_get_length: wasmExports.hb_buffer_get_length,
            hb_buffer_get_glyph_infos: wasmExports.hb_buffer_get_glyph_infos,
            hb_buffer_get_glyph_positions: wasmExports.hb_buffer_get_glyph_positions,
        };

        const fontData = fs.readFileSync('public/fonts/Roboto-Regular.ttf');
        const u8 = new Uint8Array(fontData);

        const blobPtr = hb.malloc(u8.length);
        hb.heapu8.set(u8, blobPtr);
        const blob = hb.hb_blob_create(blobPtr, u8.length, 2, blobPtr, 0);
        const face = hb.hb_face_create(blob, 0);
        const font = hb.hb_font_create(face);

        const buffer = hb.hb_buffer_create();

        // "Hello World"
        const text = "Hello World";
        const encoder = new TextEncoder();
        const textBytes = encoder.encode(text);
        const textPtr = hb.malloc(textBytes.length);
        // Need to recreate typed view in case memory grew during earlier malloc
        new Uint8Array(wasmExports.memory.buffer).set(textBytes, textPtr);

        hb.hb_buffer_add_utf8(buffer, textPtr, textBytes.length, 0, textBytes.length);
        hb.hb_buffer_guess_segment_properties(buffer);

        hb.hb_shape(font, buffer, 0, 0);

        const length = hb.hb_buffer_get_length(buffer);
        console.log("Length:", length);

        // get positions array
        const infosPtr32 = hb.hb_buffer_get_glyph_infos(buffer, 0) / 4;
        const posPtr32 = hb.hb_buffer_get_glyph_positions(buffer, 0) / 4;

        const infos = new Uint32Array(wasmExports.memory.buffer, infosPtr32 * 4, length * 5);
        const positions = new Int32Array(wasmExports.memory.buffer, posPtr32 * 4, length * 5);

        for (let i = 0; i < length; i++) {
            console.log({
                GlyphId: infos[i * 5 + 0],
                Cluster: infos[i * 5 + 2],
                XAdvance: positions[i * 5 + 0],
                YAdvance: positions[i * 5 + 1],
            });
        }
    });
});
