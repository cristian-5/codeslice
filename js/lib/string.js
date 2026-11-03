// #include <string>

// getline(cin, s) and getline(cin, s, delim): the second argument is written (see "refs"
// in Library, tree.js). Like in C++ it exists only as std::getline.
// The rules of the input (what is left in the buffer...) are in Cin, tree.js.

Library.register("string", {
	getline: [
		{ args: [ "istream", "string" ], ret: "bool", stdOnly: true, refs: [ 1 ],
			run: async (stream, set) => { await set(await Cin.line("\n")); return true; } },
		{ args: [ "istream", "string", "char" ], ret: "bool", stdOnly: true, refs: [ 1 ],
			run: async (stream, set, delim) => { await set(await Cin.line(String.fromCharCode(delim))); return true; } },
	],
});
