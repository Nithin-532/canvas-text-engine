import fs from 'fs';
const wasm = fs.readFileSync('node_modules/harfbuzzjs/hb.wasm');
const env = {
    _abort_js: () => { }, _emscripten_runtime_keepalive_clear: () => { }, _setitimer_js: () => 0,
    emscripten_resize_heap: () => false, proc_exit: () => { }, memory: new WebAssembly.Memory({ initial: 256 })
};
WebAssembly.instantiate(wasm, { env, wasi_snapshot_preview1: env }).then(res => {
    const keys = Object.keys(res.instance.exports);
    console.log("free related keys:", keys.filter(k => k.includes('free') || k.includes('ptr')));
});
