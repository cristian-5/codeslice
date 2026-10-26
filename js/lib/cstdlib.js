
// #include <cstdlib>

Library.register("cstdlib", {
	abs:  [ { args: [ "int" ], ret: "int", run: Math.abs } ],
	rand: [ { args: [], ret: "int", run: () => Math.floor(Math.random() * 0x7FFFFFFF) } ],
}, {
	NULL: { type: "int", value: 0 },
});

Library.register("cstddef", { }, {
	NULL: { type: "int", value: 0 },
});

Library.register("", { }, {
	nullptr: { type: "int", value: 0 },
});
