import fs from 'fs';
const wasm = fs.readFileSync('node_modules/harfbuzzjs/hb.wasm');
const wasmMemory = new WebAssembly.Memory({ initial: 256 });
const env = {
    _abort_js: () => {}, _emscripten_runtime_keepalive_clear: () => {}, _setitimer_js: () => 0,
    emscripten_resize_heap: function(size) {
        const oldSize = wasmMemory.buffer.byteLength;
        if (size > oldSize) {
            wasmMemory.grow((size - oldSize + 65535) >>> 16);
        }
        return true;
    }, proc_exit: () => {}, memory: wasmMemory
};
WebAssembly.instantiate(wasm, {env, wasi_snapshot_preview1: env}).then(res => {
   res.instance.exports.malloc(1024 * 1024 * 20); // 20MB alloc
   console.log("Memory successfully allocated 20MB! Buffer size:", wasmMemory.buffer.byteLength);
}).catch(console.error);
