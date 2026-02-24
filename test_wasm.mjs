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
                console.log(`Growing from ${oldPages} to ${newPages} (req=${requestedSize})`);
                try {
                    memory.grow(newPages - oldPages);
                    return 1;
                } catch (e) {
                    return 0;
                }
            }
        }
    }).then(instance => {
        wasmExports = instance.exports;
        console.log("Calling malloc(515100)...");
        const ptr = wasmExports.malloc(515100);
        console.log("Malloc returned:", ptr);
    });
});
