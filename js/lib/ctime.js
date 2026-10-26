
// #include <ctime>

Library.register("ctime", {
	time: [ { args: [], ret: "int", run: () => Date.now() } ],
});
