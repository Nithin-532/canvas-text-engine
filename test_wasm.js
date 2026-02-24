const fs = require('fs');
const buf = fs.readFileSync('node_modules/harfbuzzjs/hb.wasm');
WebAssembly.compile(buf).then(mod => {
  console.log("Imports:", WebAssembly.Module.imports(mod));
  console.log("Exports:", WebAssembly.Module.exports(mod));
});
