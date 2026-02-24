import("harfbuzzjs/hb.js").then(mod => {
    console.log("dynamically imported harfbuzz module keys:", Object.keys(mod));
    console.log("default type:", typeof mod.default, typeof mod.default.default);
});
