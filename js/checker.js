
// ==== Static type checker ====================================================
//
// Runs between the parser and the interpreter:
//
//     const ast = await new Parser(code).parse();
//     new TypeChecker().check(ast);   // throws a CodeError, like the parser does
//     await ast.execute();
//
// Types are strings: "int", "float", "char", "bool", "string", "void", and
// arrays "int[]", "int[][]" (the sizes are only known when the program runs).
// There are no implicit conversions: both sides of an assignment, an
// initialization, a return and each argument of a call must have the same type.
//
// The checker needs to know what every name means, so it resolves names with
// the same rules as Environment (see SymbolScope) and reports the errors of
// that too: undefined names, redefinitions, std:: / using, overloads...
// What only depends on values stays in the interpreter: uninitialized
// variables, division by zero, array indexes, duplicate case values, loops...

// ==== Types ==================================================================

class TypeRules {

	static isNumeric(t) { return t === "int" || t === "char" || t === "float"; }
	static isIntegral(t) { return t === "int" || t === "char"; }
	static isCondition(t) { return t === "bool" || t === "int"; }
	static isArray(t) { return t.endsWith("]"); }
	static arrayOf(base, dimensions) { return base + "[]".repeat(dimensions); }
	static elementOf(t) { return t.replace(/\[\]/g, ""); }
	static dimensions(t) { return (t.match(/\[\]/g) || []).length; }

	// "left operator right" -> type of the result
	static #arithmetic = (() => {
		const table = new Map();
		const add = (op, ...rows) => rows.forEach(([ l, r, result ]) => table.set(l + op + r, result));
		const product = [
			[ "int", "int", "int" ], [ "int", "char", "int" ], [ "char", "int", "int" ],
			[ "int", "float", "float" ], [ "float", "int", "float" ], [ "float", "float", "float" ],
		];
		add("+", [ "string", "string", "string" ], [ "char", "char", "char" ],
			[ "int", "int", "int" ], [ "int", "char", "int" ], [ "char", "int", "int" ],
			[ "int", "float", "float" ], [ "float", "int", "float" ], [ "float", "float", "float" ]);
		add("-", ...product);
		add("*", ...product);
		add("/", ...product);
		add("%", [ "int", "int", "int" ], [ "int", "char", "int" ], [ "char", "int", "int" ]);
		add("&", [ "int", "int", "int" ]);
		add("|", [ "int", "int", "int" ]);
		return table;
	})();

	/// Type of "l op r", or null if the operator doesn't accept those types.
	static infix(op, l, r) {
		const { isNumeric } = TypeRules;
		switch (op) {
			case "&&": case "||":
				return l === "bool" && r === "bool" ? "bool" : null;
			case ">": case "<": case ">=": case "<=":
				return isNumeric(l) && isNumeric(r) ? "bool" : null;
			case "==": case "!=":
				return (isNumeric(l) && isNumeric(r)) || (l === r && (l === "string" || l === "bool"))
					? "bool" : null;
			default:
				return TypeRules.#arithmetic.get(l + op + r) ?? null;
		}
	}

	/// Type of "op t" (-, !, ~, ++, --), or null.
	static prefix(op, t) {
		switch (op) {
			case "-": return t === "float" ? "float" : TypeRules.isIntegral(t) ? "int" : null;
			case "~": return TypeRules.isIntegral(t) ? "int" : null;
			case "!": return t === "bool" ? "bool" : null;
			case "++": case "--": return TypeRules.isNumeric(t) ? t : null;
		}
		return null;
	}

	/// Type of "t++" and "t--", or null.
	static postfix(t) { return TypeRules.isNumeric(t) ? t : null; }

}

// ==== Symbols ================================================================

/// A variable or constant.
class VarInfo {
	// constant: const AND initialized with a constant expression (usable as array size)
	constructor(type, isConst = false, constant = false) {
		this.type = type;
		this.isConst = isConst;
		this.constant = constant;
	}
}

/// All the functions sharing one name (overloads) in one scope.
/// entry: { token, returnType, types, body (is it defined, or just a prototype?) }
class FuncInfo {
	constructor(name) {
		this.name = name;
		this.overloads = [];
	}
	find(types) {
		return this.overloads.find(f =>
			f.types.length === types.length && f.types.every((t, i) => t === types[i]));
	}
}

/// cout and cin
class StreamInfo { }

/// The compile time twin of Environment: same scopes, same rules to find a name,
/// but it stores the type of the names instead of their values.
class SymbolScope {

	/// The `name` is only given for namespaces (`""` for global).
	constructor(parent, name) {
		this.parent = parent;
		this.root = parent ? parent.root : this;
		this.values = new Map();     // variables and functions
		this.namespaces = new Map(); // nested namespaces
		this.aliases = new Map();    // "using std::x;"  (name -> scope owning it)
		this.usings = [];            // "using namespace x;"
	}

	static createGlobal() {
		const global = new SymbolScope(undefined, "");
		global.values.set("true",  new VarInfo("bool", true, true));
		global.values.set("false", new VarInfo("bool", true, true));
		const std = new SymbolScope(global, "std");
		std.values.set("endl", new VarInfo("string", true));
		std.values.set("cout", new StreamInfo());
		std.values.set("cin",  new StreamInfo());
		global.namespaces.set("std", std);
		return global;
	}

	get std() { return this.root.namespaces.get("std"); }

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

	/// Opens (and creates, if needed) the namespace `id` inside of this scope.
	openNamespace(id) {
		if (!this.namespaces.has(id)) this.namespaces.set(id, new SymbolScope(this, id));
		return this.namespaces.get(id);
	}

	/// What the name means, or undefined if it is unknown.
	lookup(token) {
		if (token.qualifiers)
			return this.findNamespace(token.qualifiers).values.get(token.member);
		const owner = this.#owner(token.lexeme);
		return owner && owner.values.get(token.lexeme);
	}

	/// Like lookup() but an unknown name is an error.
	resolve(token) {
		const errors = Language.main.errors;
		let owner;
		if (token.qualifiers) {
			const ns = this.findNamespace(token.qualifiers);
			if (ns.values.has(token.member)) owner = ns;
		} else owner = this.#owner(token.lexeme);
		if (owner) return owner.values.get(Environment.key(token));
		if (!token.qualifiers && this.std.values.has(token.lexeme))
			throw new CodeError(errors.NDS, token, [ token.lexeme, token.lexeme ]);
		throw new CodeError(errors.UVR, token, [ token.lexeme ]);
	}

	/// cout / cin need `using namespace std;` or std::
	require(token) {
		if (this.lookup(token) === undefined)
			throw new CodeError(Language.main.errors.NDS, token, [ token.lexeme, token.lexeme ]);
	}

	define(token, info) {
		if (this.values.has(token.lexeme) || this.aliases.has(token.lexeme))
			throw new CodeError(Language.main.errors.VRD, token, [ token.lexeme ]);
		this.values.set(token.lexeme, info);
	}

	defineFunction(entry) {
		const errors = Language.main.errors, name = entry.token.lexeme;
		let set = this.values.get(name);
		if (set === undefined) {
			set = new FuncInfo(name);
			this.values.set(name, set);
		} else if (!(set instanceof FuncInfo))
			throw new CodeError(errors.VRD, entry.token, [ name ]);
		const existing = set.find(entry.types);
		if (!existing) { set.overloads.push(entry); return; }
		if (existing.returnType !== entry.returnType || (existing.body && entry.body))
			throw new CodeError(errors.FRD, entry.token, [ name ]);
		if (entry.body) Object.assign(existing, entry); // definition after a prototype
	}

}

// ==== Checker ================================================================

class TypeChecker {

	#scope = null;     // SymbolScope being checked
	#function = null;  // { returnType } of the function being checked
	#bodies = [];      // function bodies, checked after everything else

	check(program) {
		if (program) program.accept(this);
		return program;
	}

	#fail(code, at, args) {
		throw new CodeError(Language.main.errors[code], at, args);
	}
	#range(node) { return [ node.start, node.end ]; }

	/// Runs `action` inside of a new scope.
	#inScope(scope, action) {
		const outer = this.#scope;
		this.#scope = scope;
		try { return action(); } finally { this.#scope = outer; }
	}

	/// A variable declared with const cannot be assigned, incremented or read by cin.
	#assertMutable(identifier) {
		const info = this.#scope.resolve(identifier.name);
		if (info instanceof VarInfo && info.isConst)
			this.#fail("CAS", this.#range(identifier), [ identifier.name.lexeme ]);
	}

	/// Visits a condition (if, while, do, for): it must be bool or int.
	#condition(expression) {
		const t = expression.accept(this);
		if (!TypeRules.isCondition(t))
			this.#fail("BOO", this.#range(expression), [ t ]);
	}

	// ---- Program --------------------------------------------------------------

	// Like in the interpreter, functions and namespaces are declared first (hoist),
	// so the order of the functions in the file doesn't matter. The body of the
	// functions is checked at the end, when all the global names are known.
	visitProgram(node) {
		this.#scope = SymbolScope.createGlobal();
		this.#function = null;
		this.#bodies = [];
		for (const item of node.items) if (item.hoist) item.hoist(this);
		for (const item of node.items) item.accept(this);
		for (const { definition, scope } of this.#bodies) this.#checkBody(definition, scope);
	}

	hoistFunctionDefinition(node) {
		this.#scope.defineFunction({
			token: node.name,
			returnType: node.returnTypeName,
			types: node.paramTypes,
			body: !!node.body,
		});
		if (node.body) this.#bodies.push({ definition: node, scope: this.#scope });
	}

	hoistNamespaceDeclaration(node) {
		this.#inScope(this.#scope.openNamespace(node.name.lexeme), () => {
			for (const item of node.items) if (item.hoist) item.hoist(this);
		});
	}

	#checkBody(definition, scope) {
		// the body runs directly in the scope of the parameters, like in C++
		this.#inScope(new SymbolScope(scope), () => {
			this.#function = { returnType: definition.returnTypeName };
			try {
				definition.params.forEach((p, i) => this.#scope.define(p.id, new VarInfo(definition.paramTypes[i])));
				for (const s of definition.body.statements) s.accept(this);
			} finally { this.#function = null; }
		});
	}

	visitFunctionDefinition() { } // declared by hoist, body checked by visitProgram

	visitNamespaceDeclaration(node) {
		this.#inScope(this.#scope.openNamespace(node.name.lexeme), () => {
			for (const item of node.items) item.accept(this);
		});
	}

	visitUsingNamespace(node) {
		const ns = this.#scope.findNamespace(node.path);
		if (!this.#scope.usings.includes(ns)) this.#scope.usings.push(ns);
	}

	visitUsingDeclaration(node) {
		const t = node.token, scope = this.#scope;
		const ns = scope.findNamespace(t.qualifiers);
		if (ns.values.has(t.member)) scope.aliases.set(t.member, ns);
		else if (!(ns === scope.std && (Call.hasBuiltin(t.member) || t.member === "string")))
			this.#fail("UVR", t, [ t.lexeme ]); // (string is a type, see Parser)
	}

	// ---- Declarations ---------------------------------------------------------

	visitDeclaration(node) {
		const type = node.typeName;
		for (const d of node.declarations) {
			let info;
			if (d.exp) { // initialized
				const t = d.exp.accept(this);
				if (t !== type)
					this.#fail("CST", this.#range(node), [ type, t ]);
				info = new VarInfo(type, node.isConst, node.isConst && d.exp.isConstant);
			} else if (d.sizes) { // array
				d.sizes.forEach(size => size.accept(this));
				for (const size of d.sizes)
					if (!size.isConstant) this.#fail("ASC", this.#range(size));
				for (const size of d.sizes)
					if (size.valueType !== "int") this.#fail("ASI", this.#range(size), [ size.valueType ]);
				info = new VarInfo(TypeRules.arrayOf(type, d.sizes.length));
			} else info = new VarInfo(type);
			this.#scope.define(d.id, info);
		}
	}

	// ---- Statements -----------------------------------------------------------

	visitBlock(node) {
		this.#inScope(new SymbolScope(this.#scope), () => {
			for (const s of node.statements) s.accept(this);
		});
	}

	visitInstruction(node) { node.expression.accept(this); }

	visitIf(node) {
		this.#condition(node.condition);
		node.then.accept(this);
		if (node.els) node.els.accept(this);
	}

	visitWhile(node) {
		this.#condition(node.condition);
		node.block.accept(this);
	}

	visitDoWhile(node) {
		node.block.accept(this);
		this.#condition(node.condition);
	}

	visitFor(node) {
		this.#inScope(new SymbolScope(this.#scope), () => {
			if (node.init) node.init.accept(this);
			if (node.condition) this.#condition(node.condition);
			if (node.increment) node.increment.accept(this);
			node.block.accept(this);
		});
	}

	visitSwitch(node) {
		const t = node.expression.accept(this);
		if (!TypeRules.isIntegral(t))
			this.#fail("SWT", this.#range(node.expression), [ t ]);
		this.#inScope(new SymbolScope(this.#scope), () => { // the whole body is one scope
			for (const s of node.body) s.accept(this);
		});
	}

	visitCaseLabel(node) {
		const e = node.expression, t = e.accept(this);
		if (!e.isConstant) this.#fail("CSC", this.#range(e));
		if (!TypeRules.isIntegral(t)) this.#fail("CLT", this.#range(e), [ t ]);
	}

	visitDefaultLabel() { }
	visitBreak() { }
	visitContinue() { }

	visitReturn(node) {
		const e = node.expression;
		const t = e ? e.accept(this) : null;
		if (!this.#function) return;
		const expected = this.#function.returnType;
		if (expected === "void") {
			if (e) this.#fail("RVD", this.#range(e));
		} else if (!e) this.#fail("RNV", this.#range(node));
		else if (t !== expected) this.#fail("CST", this.#range(e), [ expected, t ]);
	}

	visitCout(node) {
		if (!node.qualified) this.#scope.require(node.c);
		for (const e of node.expressions) e.accept(this);
	}

	visitCin(node) {
		if (!node.qualified) this.#scope.require(node.c);
		for (const e of node.expressions) {
			if (e instanceof Identifier) this.#assertMutable(e);
			const t = e.accept(this);
			if (TypeRules.isArray(t)) this.#fail("CIX", this.#range(e));
			if (![ "int", "float", "char", "string", "bool" ].includes(t))
				this.#fail("CIT", this.#range(e), [ t ]);
		}
	}

	// ---- Expressions ----------------------------------------------------------

	visitLiteral(node) {
		node.isConstant = true;
		return node.valueType = node.type;
	}

	visitIdentifier(node) {
		const info = this.#scope.resolve(node.name);
		if (!(info instanceof VarInfo)) // a function (or cout) used as a value
			this.#fail("UEX", this.#range(node));
		node.isConstant = info.isConst && info.constant;
		return node.valueType = info.type;
	}

	visitAssignment(node) {
		const target = node.left;
		if (target instanceof Identifier) this.#assertMutable(target);
		const l = target.accept(this);
		if (TypeRules.isArray(l)) // a whole array cannot be assigned
			this.#fail("IAT", this.#range(target));
		// a += b is checked as a = a + b: the result must have the type of a
		const r = node.value.accept(this);
		if (l !== r) this.#fail("CST", this.#range(node), [ l, r ]);
		return node.valueType = l;
	}

	visitInfixExpression(node) {
		const l = node.left.accept(this), r = node.right.accept(this);
		const op = node.operator.lexeme, type = TypeRules.infix(op, l, r);
		if (!type) this.#fail("UOB", node.operator, [ op, l, r ]);
		node.isConstant = node.left.isConstant && node.right.isConstant;
		return node.valueType = type;
	}

	visitPrefixExpression(node) {
		const op = node.operator.lexeme, target = node.right;
		const changes = op === "++" || op === "--";
		if (changes) {
			if (!(target instanceof Identifier || target instanceof Subscript))
				this.#fail("IAT", this.#range(target));
			if (target instanceof Identifier) this.#assertMutable(target);
		}
		const t = target.accept(this), type = TypeRules.prefix(op, t);
		if (!type) this.#fail("UPO", node.operator, [ op, t ]);
		node.isConstant = !changes && target.isConstant;
		return node.valueType = type;
	}

	visitPostfixExpression(node) {
		const target = node.left;
		if (!(target instanceof Identifier || target instanceof Subscript))
			this.#fail("IAT", this.#range(target));
		if (target instanceof Identifier) this.#assertMutable(target);
		const t = target.accept(this), type = TypeRules.postfix(t);
		if (!type) this.#fail("UPP", node.operator, [ node.operator.lexeme, t ]);
		return node.valueType = type;
	}

	visitSubscript(node) {
		if (!(node.left instanceof Identifier))
			this.#fail("SNA", this.#range(node));
		const t = node.left.accept(this), dimensions = TypeRules.dimensions(t);
		if (dimensions === 0) this.#fail("SNA", this.#range(node));
		if (node.indexes.length !== dimensions)
			this.#fail("ISD", this.#range(node), [ dimensions, node.indexes.length ]);
		for (const index of node.indexes) {
			const it = index.accept(this);
			if (it !== "int") this.#fail("IST", this.#range(index), [ it ]);
		}
		return node.valueType = TypeRules.elementOf(t);
	}

	visitCall(node) {
		if (!(node.callee instanceof Identifier))
			this.#fail("UEX", this.#range(node.callee));
		const token = node.callee.name, qualified = !!token.qualifiers;
		const name = Environment.key(token), at = this.#range(node);
		const symbol = this.#scope.lookup(token);
		if (symbol !== undefined && !(symbol instanceof FuncInfo))
			this.#fail("NAF", token, [ token.lexeme ]);
		const types = node.args.map(a => a.accept(this));
		node.signature = types;
		node.builtin = null;
		// 1) functions defined in the program
		const fn = symbol && symbol.find(types);
		if (fn) return node.valueType = fn.returnType;
		// 2) built-in functions (always available, or through std::)
		const builtins = Call.hasBuiltin(name) && (!qualified ||
			this.#scope.findNamespace(token.qualifiers) === this.#scope.std)
			? Call.builtins(name) : null;
		const builtin = builtins && builtins.find(
			f => f.args.length === types.length && f.args.every((t, i) => t === types[i])
		);
		if (builtin) {
			node.builtin = builtin;
			return node.valueType = builtin.ret;
		}
		if (!symbol && !builtins) this.#fail("UFN", token, [ name ]);
		// a single candidate with the right number of arguments: say which one is wrong
		const candidates = [
			...(symbol ? symbol.overloads.map(o => o.types) : []),
			...(builtins ? builtins.map(b => b.args) : [])
		].filter(c => c.length === types.length);
		if (candidates.length === 1) {
			const i = candidates[0].findIndex((t, i) => t !== types[i]);
			this.#fail("CST", this.#range(node.args[i]), [ candidates[0][i], types[i] ]);
		}
		this.#fail("FNF", at, [ name ]);
	}

}
