
// #include <cstdlib>

Library.register("cstdlib", {
	abs:  [ { args: [ "int" ], ret: "int", run: Math.abs } ],
	rand: [ { args: [], ret: "int", run: () => Math.floor(Math.random() * 0x7FFFFFFF) } ],
});
