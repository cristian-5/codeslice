
// ==== Settings ===============================================================

/// Recursion limit, protects against infinite recursion.
const MAX_CALL_DEPTH = 2000;

// Evaluates expressions one after the other, never in parallel: function calls
// swap Environment.current, so overlapping evaluations would corrupt it.
async function evalAll(expressions) {
	const values = [];
	for (const e of expressions) values.push(await e.execute());
	return values;
}

// ==== Const helpers ==========================================================

/// Throws if the identifier refers to a const variable (assignment, ++, --, cin).
function assertMutable(identifier) {
	const v = Environment.current.get(identifier.name);
	if (v instanceof Value && v.isConst)
		throw new CodeError(Language.main.errors.CAS,
			[ identifier.start, identifier.end ], [ identifier.name.lexeme ]);
}

/// Is the expression made only of literals and constants?
function isConstantExpression(e) {
	if (e instanceof Literal) return true;
	if (e instanceof Identifier) {
		const v = Environment.current.get(e.name);
		return v instanceof Value && v.isConst && v.constant;
	}
	if (e instanceof InfixExpression)
		return isConstantExpression(e.left) && isConstantExpression(e.right);
	if (e instanceof PrefixExpression)
		return ![ "++", "--" ].includes(e.operator.lexeme) && isConstantExpression(e.right);
	return false;
}

/// Array sizes must be constant expressions: int a[5]; int b[N]; int c[N * 2 + 1];
/// (the type of the result is checked later, see ASI)
function assertArraySize(e) {
	if (!isConstantExpression(e))
		throw new CodeError(Language.main.errors.ASC, [ e.start, e.end ]);
}

// ==== Values =================================================================

class Value {
	isConst = false;  // declared with "const" (clone() never copies this)
	constant = false; // const AND initialized with a constant expression (usable as array size)
	constructor(value, type = "int") {
		this.value = value;
		this.type = type;
	}
	get dimensions() {
		if (!Array.isArray(this.value)) return 0;
		let cursor = this.value, dimensions = 1;
		while (Array.isArray(cursor[0])) {
			dimensions++;
			cursor = cursor[0];
		}
		return dimensions;
	}
	get sizes() {
		if (!Array.isArray(this.value)) return [];
		let cursor = this.value, sizes = [ ];
		while (Array.isArray(cursor)) {
			sizes.push(cursor.length);
			cursor = cursor[0];
		}
		return sizes;
	}
	get base() { return this.type.replace(/\[.*\]/, ""); }
	get isArray() { return Array.isArray(this.value); }
	toString() {
		if (this.type === "char") return String.fromCharCode(this.value);
		return this.value.toString();
	}
	clone() { return new Value(structuredClone(this.value), this.type); }
}

// ==== Functions & namespaces =================================================

/// Thrown by "return" and caught by the function call that is running.
class ReturnException {
	constructor(value, statement) {
		this.value = value;         // Value, or null for a bare "return;"
		this.statement = statement; // the Return statement (for error positions)
	}
}

/// Streams like cout and cin are represented by this class.
/// It is not a Value, so it cannot be used as a variable or function argument.
class StreamSymbol { }

/// Stores all the functions sharing one name (overloads) in one scope.
class FunctionSet {
	constructor(name) {
		this.name = name;
		this.type = this.base = "function"; // used by error messages
		this.overloads = [];
	}
	find(types) {
		return this.overloads.find(f =>
			f.types.length === types.length && f.types.every((t, i) => t === types[i]));
	}
}

class Environment {

	static current = undefined;
	static global = undefined;

	static on_define = (id, data) => {};
	static on_change = (id, data) => {};

	static create() {
		const global = new Environment(undefined, "");
		global.values.set("true",  new Value(true, "bool"));
		global.values.set("false", new Value(false, "bool"));
		const std = new Environment(global, "std");
		std.values.set("endl", new Value("\n", "string"));
		std.values.set("cout", new StreamSymbol());
		std.values.set("cin",  new StreamSymbol());
		global.namespaces.set("std", std);
		Environment.global = Environment.current = global;
	}
	static open() { Environment.current = new Environment(Environment.current); }
	static close() { Environment.current = Environment.current.parent; }

	/// The `name` is only given for namespaces (`""` for global).
	constructor(parent, name) {
		this.parent = parent;
		this.values = new Map();     // variables and functions
		this.namespaces = new Map(); // nested namespaces
		this.aliases = new Map();    // "using std::x;"  (name -> environment owning it)
		this.usings = [];            // "using namespace x;"
		this.isNamespace = name !== undefined;
		this.prefix = name ? (parent ? parent.prefix : "") + name + "::" : "";
	}

	/// Environment holding the unqualified name:
	/// this scope, then the names brought in by "using", then the enclosing scopes.
	#owner(name) {
		if (this.values.has(name)) return this;
		if (this.aliases.has(name)) return this.aliases.get(name);
		for (const u of this.usings) if (u.values.has(name)) return u;
		return this.parent ? this.parent.#owner(name) : undefined;
	}

	#findNamespace(name) {
		if (this.namespaces.has(name)) return this.namespaces.get(name);
		for (const u of this.usings)
			if (u.namespaces.has(name)) return u.namespaces.get(name);
		return this.parent ? this.parent.#findNamespace(name) : undefined;
	}

	/// Resolves a chain of namespace tokens like `a::b`.
	findNamespace(tokens) {
		let ns;
		for (const t of tokens) {
			ns = ns ? ns.namespaces.get(t.lexeme) : this.#findNamespace(t.lexeme);
			if (!ns) throw new CodeError(Language.main.errors.UNS, t, [ t.lexeme ]);
		}
		return ns;
	}

	// Identifiers like `a::b` come from the parser as a single token with
	// "qualifiers" (the namespace tokens) and "member" (the last name).
	static key(token) { return token.qualifiers ? token.member : token.lexeme; }

	#resolve(token) {
		let owner;
		if (token.qualifiers) {
			const ns = this.findNamespace(token.qualifiers);
			if (ns.values.has(token.member)) owner = ns;
		} else owner = this.#owner(token.lexeme);
		if (owner) return owner;
		if (!token.qualifiers &&
			Environment.global.namespaces.get("std").values.has(token.lexeme))
			throw new CodeError(Language.main.errors.NDS, token, [ token.lexeme, token.lexeme ]);
		throw new CodeError(Language.main.errors.UVR, token, [ token.lexeme ]);
	}

	/// Like get() but returns undefined instead of throwing if the name is unknown.
	lookup(token) {
		if (token.qualifiers)
			return this.findNamespace(token.qualifiers).values.get(token.member);
		const owner = this.#owner(token.lexeme);
		return owner && owner.values.get(token.lexeme);
	}

	/// Enforces `cout` / `cin` visibility (`using namespace std;` or `std::`).
	require(token) {
		if (this.lookup(token) === undefined)
			throw new CodeError(Language.main.errors.NDS, token, [ token.lexeme, token.lexeme ]);
	}

	get(token) {
		return this.#resolve(token).values.get(Environment.key(token));
	}

	define(token, value) {
		if (this.values.has(token.lexeme) || this.aliases.has(token.lexeme))
			throw new CodeError(Language.main.errors.VRD, token, [ token.lexeme ]);
		this.values.set(token.lexeme, value);
		// globals and namespace members are shown in the debug view
		if (this.isNamespace && value instanceof Value)
			Environment.on_define(this.prefix + token.lexeme, value);
	}

	// entry: { token, returnType, types, names, body, env } or { types, returnType, native }
	defineFunction(entry) {
		const name = entry.token.lexeme;
		let set = this.values.get(name);
		if (set === undefined) {
			set = new FunctionSet(name);
			this.values.set(name, set);
		} else if (!(set instanceof FunctionSet))
			throw new CodeError(Language.main.errors.VRD, entry.token, [ name ]);
		const existing = set.find(entry.types);
		if (!existing) { set.overloads.push(entry); return; }
		if (existing.returnType !== entry.returnType || (existing.body && entry.body))
			throw new CodeError(Language.main.errors.FRD, entry.token, [ name ]);
		if (entry.body) Object.assign(existing, entry); // definition after a prototype
	}

	assign(token, value) {
		const owner = this.#resolve(token), key = Environment.key(token);
		owner.values.set(key, value);
		if (owner.isNamespace) Environment.on_change(owner.prefix + key, value);
	}

}

class Program {
	// items: top level statements; main: token of "main" (if there is a main function)
	constructor(items, main) {
		this.items = items;
		this.main = main;
	}
	async execute() {
		Environment.create();
		Call.depth = 0;
		try {
			// functions and namespaces are declared first, so that the order of
			// the functions in the file doesn't matter
			for (const item of this.items) if (item.declare) item.declare();
			for (const item of this.items) await item.execute();
			if (this.main) {
				const fn = Environment.global.values.get("main").find([]);
				const at = [ this.main.position, this.main.position + this.main.lexeme.length ];
				if (fn) await Call.invoke(fn, [], at);
			}
		} catch (e) {
			if (!(e instanceof ReturnException)) throw e; // "return;" outside of functions ends the program
		}
	}
}

// ==== Expressions ============================================================

class Expression {
	constructor(start, end) {
		this.start = start;
		this.end = end;
	}
}

class Assignment extends Expression {
	static #compound = { "+=": "+", "-=": "-", "*=": "*", "/=": "/", "%=": "%" };
	constructor(left, operator, right) {
		super(left.start, right.end);
		this.left = left;
		this.operator = operator;
		this.right = right;
		// "a += b" is evaluated as "a = a + b" (the left side is only assigned once)
		const base = Assignment.#compound[operator.lexeme];
		this.value = base ? new InfixExpression(left, { ...operator, lexeme: base }, right) : right;
	}
	async execute() {
		if (this.left instanceof Subscript) {
			const right = await this.value.execute();
			const id = await this.left.execute(right.clone(), this.start, this.end);
			const current = Environment.current.get(id);
			Environment.current.assign(id, current);
			return right;
		}
		assertMutable(this.left);
		const right = await this.value.execute();
		const value = right.clone();
		const id = Environment.current.get(this.left.name);
		if (id.type !== value.type)
			throw new CodeError(Language.main.errors.CST, [ this.start, this.end ], [
				id.type, value.type
			]);
		Environment.current.assign(this.left.name, value);
		return value;
	}
}

class Literal extends Expression {
	constructor(token, type) {
		super(token.position, token.position + token.lexeme.length);
		this.value = token.lexeme;
		this.decoded = token.value; // escape-decoded content (char/string tokens only)
		this.type = type;
	}
	async execute() {
		switch (this.type) {
			case   "char": return new Value(this.decoded.charCodeAt(0), "char");
			case "string": return new Value(this.decoded, "string");
			case  "float": return new Value(parseFloat(this.value), "float");
			case    "int": return new Value(parseInt(this.value), "int");
			default: throw new CodeError(Language.main.errors.LIT, [ this.start, this.end ], [ this.value ]);
		}
	}
}

class Identifier extends Expression {
	constructor(token) {
		super(token.position, token.position + token.lexeme.length);
		this.name = token;
	}
	async execute() {
		const value = Environment.current.get(this.name);
		if (!(value instanceof Value)) // a function name used as a value
			throw new CodeError(Language.main.errors.UEX, [ this.start, this.end ]);
		return value;
	}
}

class InfixExpression extends Expression {
	static #check = {
		"string+string": (a, b) => new Value(a.value + b.value, "string"),
		"string==string": (a, b) => new Value(a.value === b.value, "bool"),
		"string!=string": (a, b) => new Value(a.value !== b.value, "bool"),
		"int+int":    (a, b) => new Value(a.value + b.value, "int"),
		"int+float":  (a, b) => new Value(a.value + b.value, "float"),
		"int-int":    (a, b) => new Value(a.value - b.value, "int"),
		"int-char":   (a, b) => new Value(a.value - b.value, "int"),
		"int-float":  (a, b) => new Value(a.value - b.value, "float"),
		"float-int":  (a, b) => new Value(a.value - b.value, "float"),
		"int*int":    (a, b) => new Value(a.value * b.value, "int"),
		"int*float":  (a, b) => new Value(a.value * b.value, "float"),
		"int/int":    (a, b) => new Value(Math.trunc(a.value / b.value), "int"),
		"int/float":  (a, b) => new Value(a.value / b.value, "float"),
		"int%int":    (a, b) => new Value(a.value % b.value, "int"),
		"int&int":    (a, b) => new Value(a.value & b.value, "int"),
		"int|int":    (a, b) => new Value(a.value | b.value, "int"),
		"float+float": (a, b) => new Value(a.value + b.value, "float"),
		"float-float": (a, b) => new Value(a.value - b.value, "float"),
		"float*float": (a, b) => new Value(a.value * b.value, "float"),
		"float/float": (a, b) => new Value(a.value / b.value, "float"),
		"float/int":   (a, b) => new Value(a.value / b.value, "float"),
		"bool&&bool": (a, b) => new Value(a.value && b.value, "bool"),
		"bool||bool": (a, b) => new Value(a.value || b.value, "bool"),
		"bool==bool": (a, b) => new Value(a.value === b.value, "bool"),
		"bool!=bool": (a, b) => new Value(a.value !== b.value, "bool"),
		"char+char": (a, b) => new Value(a.value + b.value, "char"),
		"char+int":  (a, b) => new Value(a.value + b.value, "int"),
		"char-int":  (a, b) => new Value(a.value - b.value, "int"),
		"char*int":  (a, b) => new Value(a.value * b.value, "int"),
		"char/int":  (a, b) => new Value(Math.trunc(a.value / b.value), "int"),
		"char%int":  (a, b) => new Value(a.value % b.value, "int"),
		"int%char":  (a, b) => new Value(a.value % b.value, "int"),
		"int/char":  (a, b) => new Value(Math.trunc(a.value / b.value), "int"),
		"int>int":   (a, b) => new Value(a.value > b.value, "bool"),
		"int<int":   (a, b) => new Value(a.value < b.value, "bool"),
		"int>=int":  (a, b) => new Value(a.value >= b.value, "bool"),
		"int<=int":  (a, b) => new Value(a.value <= b.value, "bool"),
		"int==int":  (a, b) => new Value(a.value === b.value, "bool"),
		"int!=int":  (a, b) => new Value(a.value !== b.value, "bool"),
		"char>char": (a, b) => new Value(a.value > b.value, "bool"),
		"char<char": (a, b) => new Value(a.value < b.value, "bool"),
		"char>=char": (a, b) => new Value(a.value >= b.value, "bool"),
		"char<=char": (a, b) => new Value(a.value <= b.value, "bool"),
		"char==char": (a, b) => new Value(a.value === b.value, "bool"),
		"char!=char": (a, b) => new Value(a.value !== b.value, "bool"),
		"char>int":  (a, b) => new Value(a.value > b.value, "bool"),
		"char<int":  (a, b) => new Value(a.value < b.value, "bool"),
		"char>=int": (a, b) => new Value(a.value >= b.value, "bool"),
		"char<=int": (a, b) => new Value(a.value <= b.value, "bool"),
		"char==int": (a, b) => new Value(a.value === b.value, "bool"),
		"char!=int": (a, b) => new Value(a.value !== b.value, "bool"),
		"int>char":  (a, b) => new Value(a.value > b.value, "bool"),
		"int<char":  (a, b) => new Value(a.value < b.value, "bool"),
		"int>=char": (a, b) => new Value(a.value >= b.value, "bool"),
		"int<=char": (a, b) => new Value(a.value <= b.value, "bool"),
		"int==char": (a, b) => new Value(a.value === b.value, "bool"),
		"int!=char": (a, b) => new Value(a.value !== b.value, "bool"),
		"int>float":  (a, b) => new Value(a.value > b.value, "bool"),
		"int<float":  (a, b) => new Value(a.value < b.value, "bool"),
		"int>=float": (a, b) => new Value(a.value >= b.value, "bool"),
		"int<=float": (a, b) => new Value(a.value <= b.value, "bool"),
		"int==float": (a, b) => new Value(a.value === b.value, "bool"),
		"int!=float": (a, b) => new Value(a.value !== b.value, "bool"),
		"float>int":  (a, b) => new Value(a.value > b.value, "bool"),
		"float<int":  (a, b) => new Value(a.value < b.value, "bool"),
		"float>=int": (a, b) => new Value(a.value >= b.value, "bool"),
		"float<=int": (a, b) => new Value(a.value <= b.value, "bool"),
		"float==int": (a, b) => new Value(a.value === b.value, "bool"),
		"float!=int": (a, b) => new Value(a.value !== b.value, "bool"),
		"float>char":  (a, b) => new Value(a.value > b.value, "bool"),
		"float<char":  (a, b) => new Value(a.value < b.value, "bool"),
		"float>=char": (a, b) => new Value(a.value >= b.value, "bool"),
		"float<=char": (a, b) => new Value(a.value <= b.value, "bool"),
		"float==char": (a, b) => new Value(a.value === b.value, "bool"),
		"float!=char": (a, b) => new Value(a.value !== b.value, "bool"),
		"float>float":  (a, b) => new Value(a.value > b.value, "bool"),
		"float<float":  (a, b) => new Value(a.value < b.value, "bool"),
		"float>=float": (a, b) => new Value(a.value >= b.value, "bool"),
		"float<=float": (a, b) => new Value(a.value <= b.value, "bool"),
		"float==float": (a, b) => new Value(a.value === b.value, "bool"),
		"float!=float": (a, b) => new Value(a.value !== b.value, "bool"),
	};
	constructor(left, operator, right) {
		super(left.start, right.end);
		this.left = left;
		this.operator = operator;
		this.right = right;
	}
	async execute() {
		const l = await this.left.execute(), r = await this.right.execute();
		if (l.value === undefined)
			throw new CodeError(Language.main.errors.INI, [ this.left.start, this.left.end ]);
		if (r.value === undefined)
			throw new CodeError(Language.main.errors.INI, [ this.right.start, this.right.end ]);
		if ([ '/', '%' ].includes(this.operator.lexeme) && r.value === 0)
			throw new CodeError(Language.main.errors.DBZ, [ this.right.start, this.right.end ]);
		let key = l.type + this.operator.lexeme + r.type;
		if (key in InfixExpression.#check)
			return InfixExpression.#check[key](l, r);
		key = r.type + this.operator.lexeme + l.type;
		if (key in InfixExpression.#check)
			return InfixExpression.#check[key](r, l);
		throw new CodeError(Language.main.errors.UOB, this.operator, [
			this.operator.lexeme, l.type, r.type
		]);
	}
}

class PrefixExpression extends Expression {
	static #check = {
		"-int":    a => new Value(-a.value, "int"),
		"-char":   a => new Value(-a.value, "int"),
		"-float":  a => new Value(-a.value, "float"),
		"!bool":   a => new Value(!a.value, "bool"),
		"~int":    a => new Value(~a.value, "int"),
		"~char":   a => new Value(~a.value, "int"),
		"--int":   a => new Value(--a.value, "int"),
		"++int":   a => new Value(++a.value, "int"),
		"--char":  a => new Value(--a.value, "int"),
		"++char":  a => new Value(++a.value, "int"),
		"--float": a => new Value(--a.value, "float"),
		"++float": a => new Value(++a.value, "float"),
	};
	constructor(operator, right) {
		super(operator.position, right.end);
		this.operator = operator;
		this.right = right;
	}
	async execute() {
		if ([ "++", "--" ].includes(this.operator.lexeme)) {
			if (!(this.right instanceof Identifier || this.right instanceof Subscript))
				throw new CodeError(Language.main.errors.IAT, [ this.right.start, this.right.end ]);
			if (this.right instanceof Identifier) assertMutable(this.right);
		}
		const r = await this.right.execute();
		const key = this.operator.lexeme + r.base;
		if (r.value === undefined)
			throw new CodeError(Language.main.errors.INI, [ this.right.start, this.right.end ]);
		if (key in PrefixExpression.#check) {
			const value = PrefixExpression.#check[key](r);
			if (![ "++", "--" ].includes(this.operator.lexeme)) return value;
			if (this.right instanceof Subscript) {
				const id = await this.right.execute(value, this.start, this.end);
				const current = Environment.current.get(id);
				Environment.current.assign(id, current);
			} else if (this.right instanceof Identifier)
				Environment.current.assign(this.right.name, value);
			return value;
		}
		throw new CodeError(Language.main.errors.UPO, this.operator, [
			this.operator.lexeme, r.type
		]);
	}
}

class PostfixExpression extends Expression {
	static #check = {
		"int--":   a => new Value(a.value - 1, "int"),
		"int++":   a => new Value(a.value + 1, "int"),
		"char--":  a => new Value((a.value - 1) & 0xFF, "int"),
		"char++":  a => new Value((a.value + 1) & 0xFF, "int"),
		"float--": a => new Value(a.value - 1, "float"),
		"float++": a => new Value(a.value + 1, "float"),
	};
	constructor(left, operator) {
		super(left.start, operator.end);
		this.left = left;
		this.operator = operator;
	}
	async execute() {
		if (!(this.left instanceof Identifier || this.left instanceof Subscript))
			throw new CodeError(Language.main.errors.IAT, [ this.left.start, this.left.end ]);
		if (this.left instanceof Identifier) assertMutable(this.left);
		const l = await this.left.execute();
		if (!["int", "char", "float"].includes(l.base))
			throw new CodeError(Language.main.errors.UPP, this.operator, [
				this.operator.lexeme, l.type
			]);
		const result = l.clone();
		if (l.value === undefined)
			throw new CodeError(Language.main.errors.INI, [ this.left.start, this.left.end ]);
		const key = l.type + this.operator.lexeme;
		if (!(key in PostfixExpression.#check))
			throw new CodeError(Language.main.errors.UPP, this.operator, [
				this.operator.lexeme, l.type
			]);
		const value = PostfixExpression.#check[key](l);
		if (this.left instanceof Subscript) {
			const id = await this.left.execute(value, this.start, this.end);
			const current = Environment.current.get(id);
			Environment.current.assign(id, current);
			return result;
		}
		Environment.current.assign(this.left.name, value);
		return result;
	}
}

class Call extends Expression {
	static #functions = {
		"sqrt": [
			{ args: [ "float" ], run: Math.sqrt, ret: "float" },
			{ args: [ "int" ],   run: Math.sqrt, ret: "float" },
		],
		"abs": [
			{ args: [ "float" ], run: Math.abs, ret: "float" },
			{ args: [ "int" ],   run: Math.abs, ret: "float" },
		],
		"pow": [
			{ args: [ "float", "float" ], run: Math.pow, ret: "float" },
			{ args: [ "int", "int" ],     run: Math.pow, ret: "float" },
		],
		"sin": [
			{ args: [ "float" ], run: Math.sin, ret: "float" },
			{ args: [ "int" ],   run: Math.sin, ret: "float" },
		],
		"cos": [
			{ args: [ "float" ], run: Math.cos, ret: "float" },
			{ args: [ "int" ],   run: Math.cos, ret: "float" },
		],
		"tan": [
			{ args: [ "float" ], run: Math.tan, ret: "float" },
			{ args: [ "int" ],   run: Math.tan, ret: "float" },
		],
		"exp": [
			{ args: [ "float" ], run: Math.exp, ret: "float" },
			{ args: [ "int" ],   run: Math.exp, ret: "float" },
		],
		"log": [
			{ args: [ "float" ], run: Math.log, ret: "float" },
			{ args: [ "int" ],   run: Math.log, ret: "float" },
		],
		"floor": [ { args: [ "float" ], run: Math.floor, ret: "float" } ],
		"ceil": [ { args: [ "float" ], run: Math.ceil, ret: "float" } ],
		"round": [ { args: [ "float" ], run: Math.round, ret: "float" } ],
		"rand": [ { args: [], run: () => Math.floor(Math.random() * 0x7FFFFFFF), ret: "int" } ],
		"time": [ { args: [], run: () => Date.now(), ret: "int" } ],
	};
	static depth = 0; // current depth of function calls

	static hasBuiltin(name) { return Object.hasOwn(Call.#functions, name); }

	constructor(callee, lpar, rpar, args) {
		super(callee.start, rpar.position + 1);
		this.callee = callee;
		this.lpar = lpar;
		this.rpar = rpar;
		this.args = args;
	}

	/// Runs a function, parameters are passed by value.
	/// "at" is the [ start, end ] range used to report errors.
	static async invoke(fn, args, at) {
		if (fn.native) return new Value(fn.native(...args.map(a => a.value)), fn.returnType);
		if (!fn.body) throw new CodeError(Language.main.errors.FND, at, [ fn.token.lexeme ]);
		if (Call.depth >= MAX_CALL_DEPTH) throw new CodeError(Language.main.errors.MCD, at);
		const caller = Environment.current;
		const env = new Environment(fn.env); // sees the globals / its namespace, not the caller
		fn.names.forEach((name, i) => env.define(name, args[i].clone()));
		Environment.current = env;
		Call.depth++;
		let returned = null;
		try {
			// the body runs directly in the parameters' scope, like in C++
			for (const s of fn.body.statements) await s.execute();
		} catch (e) {
			if (e instanceof ReturnException) returned = e;
			else if (e instanceof BreakException || e instanceof ContinueException)
				throw new CodeError(Language.main.errors.BNL, [ e.statement.start, e.statement.end ]);
			else throw e;
		} finally {
			Call.depth--;
			Environment.current = caller;
		}
		if (returned) {
			const s = returned.statement, value = returned.value;
			if (fn.returnType === "void") {
				if (value) throw new CodeError(Language.main.errors.RVD, [ s.expression.start, s.expression.end ]);
				return new Value(undefined, "void");
			}
			if (!value) throw new CodeError(Language.main.errors.RNV, [ s.start, s.end ]);
			if (value.type !== fn.returnType)
				throw new CodeError(Language.main.errors.CST, [ s.expression.start, s.expression.end ], [
					fn.returnType, value.type
				]);
			return value.clone();
		}
		return new Value(undefined, fn.returnType); // the end was reached without "return"
	}

	async execute() {
		if (!(this.callee instanceof Identifier))
			throw new CodeError(Language.main.errors.UEX, [ this.callee.start, this.callee.end ]);
		const token = this.callee.name, qualified = !!token.qualifiers;
		const name = Environment.key(token), at = [ this.start, this.end ];
		const symbol = Environment.current.lookup(token);
		if (symbol !== undefined && !(symbol instanceof FunctionSet))
			throw new CodeError(Language.main.errors.NAF, token, [ token.lexeme ]);
		const args = await evalAll(this.args);
		const types = args.map(a => a.type);
		// 1) functions defined in the program
		const fn = symbol && symbol.find(types);
		if (fn) return await Call.invoke(fn, args, at);
		// 2) built-in functions (always available, or through std::)
		const builtins = Call.hasBuiltin(name) && (!qualified ||
			Environment.current.findNamespace(token.qualifiers) === Environment.global.namespaces.get("std"))
			? Call.#functions[name] : null;
		const builtin = builtins && builtins.find(
			f => f.args.length === types.length && f.args.every((t, i) => t === types[i])
		);
		if (builtin) {
			args.forEach((a, i) => {
				if (a.value === undefined)
					throw new CodeError(Language.main.errors.INI, [ this.args[i].start, this.args[i].end ]);
			});
			return new Value(builtin.run(...args.map(a => a.value)), builtin.ret);
		}
		if (!symbol && !builtins) throw new CodeError(Language.main.errors.UFN, token, [ name ]);
		// a single candidate with the right number of arguments: say which one is wrong
		const candidates = [
			...(symbol ? symbol.overloads.map(o => o.types) : []),
			...(builtins ? builtins.map(b => b.args) : [])
		].filter(c => c.length === args.length);
		if (candidates.length === 1) {
			const i = candidates[0].findIndex((t, i) => t !== types[i]);
			throw new CodeError(Language.main.errors.CST, [ this.args[i].start, this.args[i].end ], [
				candidates[0][i], types[i]
			]);
		}
		throw new CodeError(Language.main.errors.FNF, at, [ name ]);
	}
}

class Subscript extends Expression {
	constructor(left, indexes, rpar) {
		super(left.start, rpar.position + 1);
		this.left = left;
		this.indexes = indexes;
	}
	async execute(set, start, end) {
		if (!(this.left instanceof Identifier))
			throw new CodeError(Language.main.errors.SNA, [ this.start, this.end ]);
		let id = Environment.current.get(this.left.name);
		if (id.dimensions === 0) throw new CodeError(Language.main.errors.SNA, [ this.start, this.end ]);
		if (this.indexes.length !== id.dimensions)
			throw new CodeError(Language.main.errors.ISD, [ this.start, this.end ], [ id.dimensions, this.indexes.length ]);
		const indexes = await evalAll(this.indexes);
		for (let i = 0; i < indexes.length; i++)
			if (indexes[i].type !== "int")
				throw new CodeError(Language.main.errors.IST, [ this.indexes[i].start, this.indexes[i].end ], [ indexes[i].type ]);
			else if (indexes[i].value < 0 || indexes[i].value >= id.sizes[i])
				throw new CodeError(Language.main.errors.IOB, [ this.indexes[i].start, this.indexes[i].end ], [ indexes[i].value ]);
		if (set) {
			let cursor = id.value;
			for (let i = 0; i < indexes.length - 1; i++) cursor = cursor[indexes[i].value];
			if (set.type !== id.base)
				throw new CodeError(Language.main.errors.CST, [ start, end ], [ id.base, set.type ]);
			cursor[indexes.top().value] = set.value;
			return this.left.name;
		}
		let cursor = id.value;
		for (const i of indexes) cursor = cursor[i.value];
		return new Value(structuredClone(cursor), id.base);
	}
}

// ==== Statements =============================================================

class Statement {
	constructor(start, end) {
		this.start = start;
		this.end = end;
	}
}

class Declaration extends Statement {
	isDeclaration = true;
	// constToken: the "const" keyword token, or null
	constructor(type, declarations, constToken = null) {
		const last = declarations.top();
		super((constToken || type).position, last.exp ? last.exp.end : (
			last.sizes ? last.end : last.id.position + last.id.lexeme.length
		));
		this.type = type;
		this.declarations = declarations;
		this.isConst = !!constToken;
	}
	async execute() {
		for (const d of this.declarations) {
			let value;
			if (d.exp) { // assignment
				value = (await d.exp.execute()).clone(); // own copy, never share another variable's Value
				if (value.type !== this.type.lexeme)
					throw new CodeError(Language.main.errors.CST, [ this.start, this.end ], [
						this.type.lexeme, value.type
					]);
				if (this.isConst) {
					value.isConst = true;
					value.constant = isConstantExpression(d.exp);
				}
			} else if (d.sizes) { // array
				d.sizes.forEach(assertArraySize);
				const sizes = await evalAll(d.sizes);
				for (let i = 0; i < sizes.length; i++)
					if (sizes[i].type !== "int")
						throw new CodeError(Language.main.errors.ASI, [ d.sizes[i].start, d.sizes[i].end ], [ sizes[i].type ]);
					else if (sizes[i].value <= 0)
						throw new CodeError(Language.main.errors.AS0, [ d.sizes[i].start, d.sizes[i].end ], [ sizes[i].value ]);
				value = new Value(
					Array.make(sizes.map(s => s.value)),
					this.type.lexeme + d.sizes.map(s => `[${s.value}]`).join("")
				);
			} else { // simple declaration
				value = new Value(undefined, this.type.lexeme);
			}
			Environment.current.define(d.id, value);
		}
	}
}

class Block extends Statement {
	constructor(lbrace, statements, rbrace) {
		super(lbrace.position, rbrace.position + 1);
		this.lbrace = lbrace;
		this.rbrace = rbrace;
		this.statements = statements;
	}
	async execute() {
		Environment.open();
		try { for (const s of this.statements) await s.execute(); }
		finally { Environment.close(); }
	}
}

class Instruction extends Statement {
	constructor(expression) {
		super(expression.start, expression.end);
		this.expression = expression;
	}
	async execute() { await this.expression.execute(); }
}

class If extends Statement {
	constructor(keyword, condition, then, els) {
		super(keyword.position, els ? els.end : then.end);
		this.condition = condition;
		this.then = then;
		this.els = els;
	}
	async execute() {
		const condition = await this.condition.execute();
		if (condition.type !== "bool" && condition.type !== "int")
			throw new CodeError(Language.main.errors.BOO, [ this.condition.start, this.condition.end ], [ condition.type ]);
		if (condition.value) await this.then.execute();
		else if (this.els) await this.els.execute();
	}

}

const MAX_LOOP_ITERATIONS = 100000;

class While extends Statement {
	constructor(keyword, condition, block) {
		super(keyword.position, block.end);
		this.condition = condition;
		this.block = block;
	}
	async execute() {
		let condition = await this.condition.execute();
		if (condition.type !== "bool" && condition.type !== "int")
			throw new CodeError(Language.main.errors.BOO, [ this.condition.start, this.condition.end ], [ condition.type ]);
		let count = 0;
		while (condition.clone().value && count++ < MAX_LOOP_ITERATIONS) {
			try { await this.block.execute(); }
			catch (e) { // "continue" must still reach the update / condition below
				if (e instanceof BreakException) break;
				if (!(e instanceof ContinueException)) throw e;
			}
			condition = await this.condition.execute();
		}
		if (count >= MAX_LOOP_ITERATIONS)
			throw new CodeError(Language.main.errors.MLI, [ this.condition.start, this.condition.end ]);
	}
}

class DoWhile extends Statement {
	constructor(keyword, block, condition) {
		super(keyword.position, condition.end);
		this.block = block;
		this.condition = condition;
	}
	async execute() {
		let condition, count = 0;
		do {
			try { await this.block.execute(); }
			catch (e) { // "continue" must still reach the update / condition below
				if (e instanceof BreakException) break;
				if (!(e instanceof ContinueException)) throw e;
			}
			condition = await this.condition.execute();
			if (condition.type !== "bool" && condition.type !== "int")
				throw new CodeError(Language.main.errors.BOO, [ this.condition.start, this.condition.end ], [ condition.type ]);
		} while (condition.clone().value && count++ < MAX_LOOP_ITERATIONS);
		if (count >= MAX_LOOP_ITERATIONS)
			throw new CodeError(Language.main.errors.MLI, [ this.condition.start, this.condition.end ]);
	}
}

class For extends Statement {
	constructor(keyword, init, condition, increment, block) {
		super(keyword.position, block.end);
		this.init = init;
		this.condition = condition;
		this.increment = increment;
		this.block = block;
	}
	async execute() {
		Environment.open();
		try { await this.#loop(); }
		finally { Environment.close(); }
	}
	async #loop() {
		if (this.init) await this.init.execute();
		let condition, count = 0;
		if (this.condition) {
			condition = await this.condition.execute();
			if (condition.type !== "bool" && condition.type !== "int")
				throw new CodeError(Language.main.errors.BOO, [ this.condition.start, this.condition.end ], [ condition.type ]);
		}
		while ((!this.condition || condition.clone().value) && count++ < MAX_LOOP_ITERATIONS) {
			try { await this.block.execute(); }
			catch (e) { // "continue" must still reach the update / condition below
				if (e instanceof BreakException) break;
				if (!(e instanceof ContinueException)) throw e;
			}
			if (this.increment) await this.increment.execute();
			if (this.condition) condition = await this.condition.execute();
		}
		if (count >= MAX_LOOP_ITERATIONS)
			throw new CodeError(Language.main.errors.MLI, [ this.condition.start, this.condition.end ]);
	}

}

/// Markers inside the body of a switch, see Switch.
class CaseLabel extends Statement {
	constructor(keyword, expression, colon) {
		super(keyword.position, colon.position + 1);
		this.expression = expression;
	}
	async execute() { } // only a jump target
}
class DefaultLabel extends Statement {
	constructor(keyword, colon) {
		super(keyword.position, colon.position + 1);
	}
	async execute() { }
}

class Switch extends Statement {
	// body: statements mixed with CaseLabel / DefaultLabel (flat, like in C++)
	constructor(keyword, expression, body, rbrace) {
		super(keyword.position, rbrace.position + 1);
		this.expression = expression;
		this.body = body;
	}
	async execute() {
		const errors = Language.main.errors, isInteger = t => t === "int" || t === "char";
		const value = await this.expression.execute();
		if (value.value === undefined)
			throw new CodeError(errors.INI, [ this.expression.start, this.expression.end ]);
		if (!isInteger(value.type))
			throw new CodeError(errors.SWT, [ this.expression.start, this.expression.end ], [ value.type ]);
		// find where to jump, checking all the labels (not only the matching one)
		const seen = new Set();
		let start = -1, fallback = -1;
		for (let i = 0; i < this.body.length; i++) {
			const s = this.body[i];
			if (s instanceof DefaultLabel) { fallback = i; continue; }
			if (!(s instanceof CaseLabel)) continue;
			const e = s.expression, at = [ e.start, e.end ];
			if (!isConstantExpression(e)) throw new CodeError(errors.CSC, at);
			const label = await e.execute();
			if (!isInteger(label.type)) throw new CodeError(errors.CLT, at, [ label.type ]);
			if (seen.has(label.value)) throw new CodeError(errors.DCV, at, [ label.toString() ]);
			seen.add(label.value);
			if (start < 0 && label.value === value.value) start = i;
		}
		if (start < 0) start = fallback;
		if (start < 0) return;
		Environment.open(); // the whole body is one scope
		try {
			for (let i = start; i < this.body.length; i++) await this.body[i].execute(); // falls through
		} catch (e) {
			if (!(e instanceof BreakException)) throw e;
		} finally { Environment.close(); }
	}
}

class BreakException { constructor(statement) { this.statement = statement; } }
class Break extends Statement {
	constructor(keyword) {
		super(keyword.position, keyword.position + keyword.lexeme.length);
		this.keyword = keyword;
	}
	async execute() { throw new BreakException(this); }
}

class ContinueException { constructor(statement) { this.statement = statement; } }
class Continue extends Statement {
	constructor(keyword) {
		super(keyword.position, keyword.position + keyword.lexeme.length);
		this.keyword = keyword;
	}
	async execute() { throw new ContinueException(this); }
}

class Cout extends Statement {
	static print = console.log;
	constructor(c, expressions, qualified) {
		super(expressions[0].start, expressions.top().end);
		this.expressions = expressions;
		this.c = c;
		this.qualified = qualified; // written as std::cout / std::cin
	}
	async execute() {
		if (!this.qualified) Environment.current.require(this.c);
		for (const e of this.expressions) {
			const data = await e.execute();
			if (data.value === undefined)
				throw new CodeError(Language.main.errors.INI, [ e.start, e.end ]);
			Cout.print(data.toString());
		}
	}
}

class Cin extends Statement {
	static prompt = async () => prompt();
	static input_queue = [];
	constructor(c, expressions, qualified) {
		super(expressions[0].start, expressions.top().end);
		this.expressions = expressions;
		this.c = c;
		this.qualified = qualified; // written as std::cout / std::cin
	}
	async execute() {
		if (!this.qualified) Environment.current.require(this.c);
		for (const e of this.expressions) {
			if (e instanceof Identifier) assertMutable(e); // before asking for input
			let value = Cin.input_queue.shift() || await Cin.prompt(), id;
			if (e instanceof Identifier) {
				id = Environment.current.get(e.name);
				if (id.isArray)
					throw new CodeError(Language.main.errors.CIX, [ e.start, e.end ]);
			} else id = await e.execute(); // subscript
			if (Cin.input_queue.length === 0 && id.base !== "string") {
				const chunks = value.split(/[\s\n\r]+/gm);
				if (chunks.length > 1) {
					value = chunks.shift();
					Cin.input_queue.push(...chunks);
				} else value = chunks[0];
			}
			switch (id.base) {
				case "int":
					id.value = parseInt(value);
					if (isNaN(id.value)) throw new CodeError(Language.main.errors.CII, [ e.start, e.end ], [ id.type ]);
				break;
				case "float":
					id.value = parseFloat(value);
					if (isNaN(id.value)) throw new CodeError(Language.main.errors.CII, [ e.start, e.end ], [ id.type ]);
				break;
				case "char":
					id.value = value.charCodeAt(0);
					if (value.length !== 1) throw new CodeError(Language.main.errors.CII, [ e.start, e.end ], [ id.type ]);
				break;
				case "string": id.value = value; break;
				case "bool":
					if (value === "true" || value == 1) id.value = true;
					else if (value === "false" || value == 0) id.value = false;
					else throw new CodeError(Language.main.errors.CII, [ e.start, e.end ], [ id.type ]);
				break;
				default: throw new CodeError(Language.main.errors.CIT, [ e.start, e.end ], [ id.type ]);
			}
			if (e instanceof Subscript) {
				id = await e.execute(id, e.start, e.end);
				const current = Environment.current.get(id);
				Environment.current.assign(id, current);
			} else Environment.current.assign(e.name, id); // just to notify change
		}
	}
}

// ==== Functions, namespaces ==================================================

// "isDeclaration" marks what is allowed outside of functions once there is a main().
// "declare()" is the first pass of Program.execute (see there).

class FunctionDefinition extends Statement {
	isDeclaration = true;
	// body is null for a prototype: int f(int);
	constructor(returnType, name, params, body, end) {
		super(returnType.position, end);
		this.returnType = returnType;
		this.name = name;
		this.params = params; // [ { type, id } ]
		this.body = body;
	}
	declare() {
		Environment.current.defineFunction({
			token: this.name,
			returnType: this.returnType.lexeme,
			types: this.params.map(p => p.type.lexeme),
			names: this.params.map(p => p.id),
			body: this.body,
			env: Environment.current
		});
	}
	async execute() { } // already declared
}

class Return extends Statement {
	constructor(keyword, expression) {
		super(keyword.position, expression ? expression.end : keyword.position + keyword.lexeme.length);
		this.expression = expression;
	}
	async execute() {
		throw new ReturnException(this.expression ? await this.expression.execute() : null, this);
	}
}

class NamespaceDeclaration extends Statement {
	isDeclaration = true;
	constructor(keyword, name, items, rbrace) {
		super(keyword.position, rbrace.position + 1);
		this.name = name;
		this.items = items;
	}
	#open() { // namespaces can be reopened: namespace a { } namespace a { }
		const outer = Environment.current, id = this.name.lexeme;
		if (!outer.namespaces.has(id)) outer.namespaces.set(id, new Environment(outer, id));
		return outer.namespaces.get(id);
	}
	declare() {
		const outer = Environment.current;
		Environment.current = this.#open();
		try { for (const item of this.items) if (item.declare) item.declare(); }
		finally { Environment.current = outer; }
	}
	async execute() {
		const outer = Environment.current;
		Environment.current = this.#open();
		try { for (const item of this.items) await item.execute(); }
		finally { Environment.current = outer; }
	}
}

class UsingNamespace extends Statement {
	isDeclaration = true;
	constructor(keyword, path, semicolon) {
		super(keyword.position, semicolon.position + 1);
		this.path = path; // identifier tokens
	}
	async execute() {
		const env = Environment.current, ns = env.findNamespace(this.path);
		if (!env.usings.includes(ns)) env.usings.push(ns);
	}
}

class UsingDeclaration extends Statement {
	isDeclaration = true;
	constructor(keyword, token, semicolon) {
		super(keyword.position, semicolon.position + 1);
		this.token = token; // qualified token
	}
	async execute() {
		const t = this.token, env = Environment.current;
		const ns = env.findNamespace(t.qualifiers);
		if (ns.values.has(t.member)) env.aliases.set(t.member, ns);
		else if (!(ns === Environment.global.namespaces.get("std") &&
			(Call.hasBuiltin(t.member) || t.member === "string"))) // string is a type, see Parser
			throw new CodeError(Language.main.errors.UVR, t, [ t.lexeme ]);
	}
}
