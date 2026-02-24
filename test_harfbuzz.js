import fs from 'fs';
const wasm = fs.readFileSync('node_modules/harfbuzzjs/hb.wasm');
const env = {
    _abort_js: () => { throw new Error('abort'); },
    _emscripten_runtime_keepalive_clear: () => {},
    _setitimer_js: () => 0,
    emscripten_resize_heap: () => false,
    proc_exit: (code) => { throw new Error(`exit(${code})`); },
    memory: new WebAssembly.Memory({ initial: 256 })
};
const imports = {
  env: env,
  wasi_snapshot_preview1: env
};
WebAssembly.instantiate(wasm, imports).then(res => {
   console.log("SUCCESS! direct WASM instantiate exported keys:", Object.keys(res.instance.exports));
   // test a harfbuzz export
   console.log("hb_version:", res.instance.exports.hb_version_string);
}).catch(console.error);
