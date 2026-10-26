
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
// double is float.
// Explicit casts, (int)x and int(x), allow the same conversions as the implicit ones.
//
// Implicit conversions follow C++:
//  - bool, char, int and float convert to each other (assignments, initializers,
//    arguments, return, array sizes and indexes, switch). Narrowing is allowed
//    like in C++: int i = 2.7; gives 2.
//  - the operands of an arithmetic or comparison operator go through the usual
//    arithmetic conversions: bool and char become int, and if one of them is
//    float the other one becomes float too. So 'a' + 1 is an int.
//  - an expression that must be converted gets node.castTo = the target type.
//    strings don't convert to or from anything.
//
// The checker needs to know what every name means, so it resolves names with
// the same rules as Environment (see SymbolScope) and reports the errors of
// that too: undefined names, redefinitions, std:: / using, overloads...
// What only depends on values stays in the interpreter: uninitialized
// variables, division by zero, array indexes, duplicate case values, loops...

// ==== Types ==================================================================

class TypeRules {

	static isArithmetic(t) { return t === "bool" || t === "char" || t === "int" || t === "float"; }
	static isIntegral(t) { return t === "bool" || t === "char" || t === "int"; }
	static isArray(t) { return t.endsWith("]"); }
	static arrayOf(base, dimensions) { return base + "[]".repeat(dimensions); }
	static elementOf(t) { return t.replace(/\[\]/g, ""); }
	static dimensions(t) { return (t.match(/\[\]/g) || []).length; }

	/// Integral promotion: bool and char become int.
	static promote(t) { return t === "float" ? "float" : "int"; }
	/// Usual arithmetic conversions: the type both operands are converted to.
	static common(l, r) { return l === "float" || r === "float" ? "float" : "int"; }

	/// Can a value of type `from` be used where `to` is expected?
	static canConvert(from, to) {
		return from === to || (TypeRules.isArithmetic(from) && TypeRules.isArithmetic(to));
	}

	/// How good is the conversion, to choose between overloads: 0 exact match,
	/// 1 promotion (bool or char to int), 2 conversion, null impossible.
	static rank(from, to) {
		if (from === to) return 0;
		if (!TypeRules.canConvert(from, to)) return null;
		return to === "int" && (from === "bool" || from === "char") ? 1 : 2;
	}

	/// "l op r" -> { type: type of the result, operand: type the two operands
	/// are converted to (null: no conversion) }, or null if the operator
	/// doesn't accept those types.
	static infix(op, l, r) {
		const { isArithmetic, isIntegral, common } = TypeRules;
		const numbers = isArithmetic(l) && isArithmetic(r);
		switch (op) {
			case "&&": case "||": // the operands are converted to bool
				return numbers ? { type: "bool", operand: "bool" } : null;
			case "==": case "!=":
				if (l === "string" && r === "string") return { type: "bool", operand: null };
				// falls through
			case "<": case ">": case "<=": case ">=":
				return numbers ? { type: "bool", operand: common(l, r) } : null;
			case "+":
				if (l === "string" && r === "string") return { type: "string", operand: null };
				// falls through
			case "-": case "*": case "/":
				return numbers ? { type: common(l, r), operand: common(l, r) } : null;
			case "%": case "&": case "|":
				return isIntegral(l) && isIntegral(r) ? { type: "int", operand: "int" } : null;
		}
		return null;
	}

	/// Same for "op t" (-, +, !, ~, ++, --).
	static prefix(op, t) {
		const { isArithmetic, isIntegral, promote } = TypeRules;
		switch (op) {
			case "-": case "+":
				return isArithmetic(t) ? { type: promote(t), operand: promote(t) } : null;
			case "~": return isIntegral(t) ? { type: "int", operand: "int" } : null;
			case "!": return isArithmetic(t) ? { type: "bool", operand: "bool" } : null;
			case "++": case "--": {
				const type = TypeRules.postfix(t);
				return type ? { type, operand: null } : null;
			}
		}
		return null;
	}

	/// Type of "t++" and "t--", or null.
	static postfix(t) { return t === "char" || t === "int" || t === "float" ? t : null; }

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
/// entry: { token, returnType, types, body (is it defined, or just a prototype?),
///          native (true for the functions of a Library) }
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

	/// "included" are the headers of the program: their native functions are defined.
	static createGlobal(included = []) {
		const global = new SymbolScope(undefined, "");
		global.values.set("true",  new VarInfo("bool", true, true));
		global.values.set("false", new VarInfo("bool", true, true));
		const std = new SymbolScope(global, "std");
		std.values.set("endl", new VarInfo("string", true));
		std.values.set("cout", new StreamInfo());
		std.values.set("cin",  new StreamInfo());
		global.namespaces.set("std", std);
		for (const f of Library.functions(included))
			for (const scope of [ global, std ])
				scope.defineFunction({ token: { lexeme: f.name, position: 0 }, returnType: f.ret, types: f.args, native: true });
		for (const c of Library.constants(included))
			if (!global.values.has(c.name)) global.values.set(c.name, new VarInfo(c.type, true, true));
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
		const header = token.qualifiers ? undefined : Library.headerOf(token.lexeme);
		if (header) throw new CodeError(errors.NIH, token, [ token.lexeme, header ]); // NULL without its #include
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
		if (existing.native) { // a function of the program replaces a native one
			if (!entry.native) { delete existing.native; Object.assign(existing, entry); }
			return;
		}
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

	/// The expression is converted to `type` when it is evaluated (if it isn't of that type already).
	#coerce(expression, type) {
		expression.castTo = expression.valueType === type ? null : type;
	}

	/// A variable declared with const cannot be assigned, incremented or read by cin.
	#assertMutable(identifier) {
		const info = this.#scope.resolve(identifier.name);
		if (info instanceof VarInfo && info.isConst)
			this.#fail("CAS", this.#range(identifier), [ identifier.name.lexeme ]);
	}

	/// Visits a condition (if, while, do, for): any number can be a condition.
	#condition(expression) {
		const t = expression.accept(this);
		if (!TypeRules.isArithmetic(t))
			this.#fail("BOO", this.#range(expression), [ t ]);
	}

	// ---- Program --------------------------------------------------------------

	// Like in the interpreter, functions and namespaces are declared first (hoist),
	// so the order of the functions in the file doesn't matter. The body of the
	// functions is checked at the end, when all the global names are known.
	visitProgram(node) {
		this.#scope = SymbolScope.createGlobal(node.includes);
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
		if (ns.values.has(t.member)) { scope.aliases.set(t.member, ns); return; }
		if (ns === scope.std && t.member === "string") return; // string is a type, see Parser
		const header = ns === scope.std ? Library.headerOf(t.member) : undefined;
		if (header) this.#fail("NIH", t, [ t.member, header ]);
		this.#fail("UVR", t, [ t.lexeme ]);
	}

	// ---- Declarations ---------------------------------------------------------

	visitDeclaration(node) {
		const type = node.typeName;
		for (const d of node.declarations) {
			let info;
			if (d.exp) { // initialized
				const t = d.exp.accept(this);
				if (!TypeRules.canConvert(t, type))
					this.#fail("CST", this.#range(node), [ t, type ]);
				this.#coerce(d.exp, type);
				info = new VarInfo(type, node.isConst, node.isConst && d.exp.isConstant);
			} else if (d.sizes) { // array
				d.sizes.forEach(size => size.accept(this));
				for (const size of d.sizes)
					if (!size.isConstant) this.#fail("ASC", this.#range(size));
				for (const size of d.sizes) {
					if (!TypeRules.isIntegral(size.valueType))
						this.#fail("ASI", this.#range(size), [ size.valueType ]);
					this.#coerce(size, "int");
				}
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
		this.#coerce(node.expression, "int");
		this.#inScope(new SymbolScope(this.#scope), () => { // the whole body is one scope
			for (const s of node.body) s.accept(this);
		});
	}

	visitCaseLabel(node) {
		const e = node.expression, t = e.accept(this);
		if (!e.isConstant) this.#fail("CSC", this.#range(e));
		if (!TypeRules.isIntegral(t)) this.#fail("CLT", this.#range(e), [ t ]);
		this.#coerce(e, "int");
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
		else if (!TypeRules.canConvert(t, expected)) this.#fail("CST", this.#range(e), [ t, expected ]);
		else this.#coerce(e, expected);
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

	// (int)x and int(x): the same conversions as the implicit ones
	visitCast(node) {
		const t = node.expression.accept(this);
		if (!TypeRules.canConvert(t, node.typeName))
			this.#fail("CST", this.#range(node), [ t, node.typeName ]);
		node.isConstant = node.expression.isConstant;
		return node.valueType = node.typeName;
	}

	visitAssignment(node) {
		const target = node.left;
		if (target instanceof Identifier) this.#assertMutable(target);
		const l = target.accept(this);
		if (TypeRules.isArray(l)) // a whole array cannot be assigned
			this.#fail("IAT", this.#range(target));
		// a += b is checked as a = a + b: the result is converted to the type of a
		const r = node.value.accept(this);
		if (!TypeRules.canConvert(r, l)) this.#fail("CST", this.#range(node), [ r, l ]);
		this.#coerce(node.value, l);
		return node.valueType = l;
	}

	visitInfixExpression(node) {
		const l = node.left.accept(this), r = node.right.accept(this);
		const op = node.operator.lexeme, rule = TypeRules.infix(op, l, r);
		if (!rule) this.#fail("UOB", node.operator, [ op, l, r ]);
		for (const operand of [ node.left, node.right ])
			if (rule.operand) this.#coerce(operand, rule.operand);
			else operand.castTo = null;
		node.isConstant = node.left.isConstant && node.right.isConstant;
		return node.valueType = rule.type;
	}

	visitPrefixExpression(node) {
		const op = node.operator.lexeme, target = node.right;
		const changes = op === "++" || op === "--";
		if (changes) {
			if (!(target instanceof Identifier || target instanceof Subscript))
				this.#fail("IAT", this.#range(target));
			if (target instanceof Identifier) this.#assertMutable(target);
		}
		const t = target.accept(this), rule = TypeRules.prefix(op, t);
		if (!rule) this.#fail("UPO", node.operator, [ op, t ]);
		if (rule.operand) this.#coerce(target, rule.operand);
		else target.castTo = null;
		node.isConstant = !changes && target.isConstant;
		return node.valueType = rule.type;
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
			if (!TypeRules.isIntegral(it)) this.#fail("IST", this.#range(index), [ it ]);
			this.#coerce(index, "int");
		}
		return node.valueType = TypeRules.elementOf(t);
	}

	// Chooses the overload like C++: the candidates are the functions with that
	// name whose parameters accept the arguments (with implicit conversions), and
	// the winner must be better than all the others (exact match, then promotion,
	// then conversion) for at least one argument and not worse for any.
	visitCall(node) {
		if (!(node.callee instanceof Identifier))
			this.#fail("UEX", this.#range(node.callee));
		const token = node.callee.name, name = Environment.key(token);
		const symbol = this.#scope.lookup(token);
		if (symbol !== undefined && !(symbol instanceof FuncInfo))
			this.#fail("NAF", token, [ token.lexeme ]);
		const types = node.args.map(a => a.accept(this));
		if (symbol === undefined) {
			const header = Library.headerOf(name);
			if (header) this.#fail("NIH", token, [ name, header ]);
			this.#fail("UFN", token, [ name ]);
		}
		const sameCount = symbol.overloads.filter(f => f.types.length === types.length);
		const viable = sameCount.filter(f => f.types.every((t, i) => TypeRules.canConvert(types[i], t)));
		if (viable.length === 0) {
			// a single candidate with the right number of arguments: say which one is wrong
			if (sameCount.length === 1) {
				const i = sameCount[0].types.findIndex((t, i) => !TypeRules.canConvert(types[i], t));
				this.#fail("CST", this.#range(node.args[i]), [ types[i], sameCount[0].types[i] ]);
			}
			this.#fail("FNF", this.#range(node), [ name ]);
		}
		const ranks = viable.map(f => f.types.map((t, i) => TypeRules.rank(types[i], t)));
		const better = (a, b) => ranks[a].every((r, i) => r <= ranks[b][i]) && ranks[a].some((r, i) => r < ranks[b][i]);
		const best = viable.filter((_, a) => viable.every((_, b) => a === b || better(a, b)));
		if (best.length !== 1) this.#fail("AMB", this.#range(node), [ name ]);
		node.signature = best[0].types;
		node.args.forEach((arg, i) => this.#coerce(arg, best[0].types[i]));
		return node.valueType = best[0].returnType;
	}

}
