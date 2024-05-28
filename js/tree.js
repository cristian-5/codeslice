
// ==== Values =================================================================

class Value {
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
	toString() {
		if (this.type === "char") return String.fromCharCode(this.value);
		return this.value.toString();
	}
	clone() { return new Value(structuredClone(this.value), this.type); }
}

class Environment {

	static current = undefined;

	static on_define = (id, data) => {};
	static on_change = (id, data) => {};

	static create() {
		Environment.current = new Environment(undefined);
		Environment.current.values.set("true",  new Value(true, "bool"));
		Environment.current.values.set("false", new Value(false, "bool"));
		Environment.current.values.set("endl",  new Value("\n", "string"));
	}
	static open() { Environment.current = new Environment(Environment.current); }
	static close() { Environment.current = Environment.current.parent; }
	
	constructor(parent) {
		this.parent = parent;
		this.values = new Map();
	}

	define(token, value) {
		if (this.values.has(token.lexeme))
			throw new CodeError(Language.main.errors.VRD, token, [ token.lexeme ]);
		this.values.set(token.lexeme, value);
		if (!this.parent) Environment.on_define(token.lexeme, value);
	}

	assign(token, value) {
		if (this.values.has(token.lexeme)) this.values.set(token.lexeme, value);
		else if (this.parent) this.parent.assign(token, value);
		else throw new CodeError(Language.main.errors.UVR, token, [ token.lexeme ]);
		if (!this.parent) Environment.on_change(token.lexeme, value);
	}

	get(token) {
		if (this.values.has(token.lexeme)) return this.values.get(token.lexeme);
		if (this.parent) return this.parent.get(token);
		throw new CodeError(Language.main.errors.UVR, token, [ token.lexeme ]);
	}

}

class Program {
	constructor(statements) { this.statements = statements; }
	async execute() {
		Environment.create();
		for (const statement of this.statements)
			await statement.execute();
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
	constructor(left, operator, right) {
		super(left.start, right.end);
		this.left = left;
		this.operator = operator;
		this.right = right;
	}
	async execute() {
		if (this.left instanceof Subscript) {
			const right = await this.right.execute();
			const id = await this.left.execute(right.clone(), this.start, this.end);
			const current = Environment.current.get(id);
			Environment.current.assign(id, current);
			return right;
		}
		const right = await this.right.execute();
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
		this.type = type;
	}
	async execute() {
		switch (this.type) {
			case   "char": return new Value(this.value.charCodeAt(1), "char");
			case "string": return new Value(this.value.slice(1, -1), "string");
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
	async execute() { return Environment.current.get(this.name); }
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
		const r = await this.right.execute();
		let key = this.operator.lexeme + r.type, value;
		if (r.value === undefined)
			throw new CodeError(Language.main.errors.INI, [ this.right.start, this.right.end ]);
		if (key in PrefixExpression.#check) {
			value = PrefixExpression.#check[key](r);
			if (![ "++", "--" ].includes(this.operator.lexeme)) return value;
			if (this.right instanceof Identifier)
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
		"int--":   a => new Value(a.value--, "int"),
		"int++":   a => new Value(a.value++, "int"),
		"char--":  a => new Value(a.value--, "int"),
		"char++":  a => new Value(a.value++, "int"),
		"float--": a => new Value(a.value--, "float"),
		"float++": a => new Value(a.value++, "float"),
	};
	constructor(left, operator) {
		super(left.start, operator.end);
		this.left = left;
		this.operator = operator;
	}
	async execute() {
		const l = await this.left.execute();
		if (l.value === undefined)
			throw new CodeError(Language.main.errors.INI, [ this.left.start, this.left.end ]);
		if (!this.left instanceof Identifier)
			throw new CodeError(Language.main.errors.IAT, [ this.left.start, this.left.end ]);
		let value = new Value(l.value, l.type);
		if (this.operator.lexeme === "++") value.value++;
		else value.value--;
		Environment.current.assign(this.left.name, value);
		return value;
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
	constructor(callee, lpar, rpar, args) {
		super(callee.start, rpar.position + 1);
		this.callee = callee;
		this.lpar = lpar;
		this.rpar = rpar;
		this.args = args;
	}
	async execute() {
		const name = this.callee.name.lexeme;
		if (!Call.#functions[name])
			throw new CodeError(Language.main.errors.UFN, this.callee.name, [ name ]);
		const args = await Promise.all(this.args.map(a => a.execute()));
		const arg_types = args.map(a => a.type);
		const func = Call.#functions[name].find(
			f => f.args.length === this.args.length &&
			f.args.every((t, i) => t === arg_types[i])
		);
		if (!func) throw new CodeError(Language.main.errors.FNF, [ this.start, this.end ], [ name ]);
		for (let i = 0; i < args.length; i++)
			if (args[i].type !== func.args[i])
				throw new CodeError(Language.main.errors.CST, [ this.args[i].start, this.args[i].end ], [ func.args[i], args[i].type ]);
		return new Value(func.run(...args.map(a => a.value)), func.ret);
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
		const indexes = await Promise.all(this.indexes.map(i => i.execute()));
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
	constructor(type, declarations) {
		const last = declarations.top();
		super(type.position, last.exp ? last.exp.end : (
			last.sizes ? last.sizes.end : last.id.position + last.id.lexeme.length
		));
		this.type = type;
		this.declarations = declarations;
	}
	async execute() {
		for (const d of this.declarations) {
			let value;
			if (d.exp) { // assignment
				value = await d.exp.execute();
				if (value.type !== this.type.lexeme)
					throw new CodeError(Language.main.errors.CST, [ this.start, this.end ], [
						this.type.lexeme, value.type
					]);
			} else if (d.sizes) { // array
				const sizes = await Promise.all(d.sizes.map(s => s.execute()));
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
		for (const s of this.statements) await s.execute();
		Environment.close();
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
		super(keyword.start, els ? els.end : then.end);
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
		super(keyword.start, block.end);
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
			catch (e) {
				if (e instanceof BreakException) break;
				if (e instanceof ContinueException) continue;
				else throw e;
			}
			condition = await this.condition.execute();
		}
		if (count >= MAX_LOOP_ITERATIONS)
			throw new CodeError(Language.main.errors.MLI, [ this.condition.start, this.condition.end ]);
	}
}

class DoWhile extends Statement {
	constructor(keyword, block, condition) {
		super(keyword.start, condition.end);
		this.block = block;
		this.condition = condition;
	}
	async execute() {
		let condition, count = 0;
		do {
			try { await this.block.execute(); }
			catch (e) {
				if (e instanceof BreakException) break;
				if (e instanceof ContinueException) continue;
				else throw e;
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
		super(keyword.start, block.end);
		this.init = init;
		this.condition = condition;
		this.increment = increment;
		this.block = block;
	}
	async execute() {
		Environment.open();
		if (this.init) await this.init.execute();
		let condition, count = 0;
		if (this.condition) {
			condition = await this.condition.execute();
			if (condition.type !== "bool" && condition.type !== "int")
				throw new CodeError(Language.main.errors.BOO, [ this.condition.start, this.condition.end ], [ condition.type ]);
		}
		while ((!this.condition || condition.clone().value) && count++ < MAX_LOOP_ITERATIONS) {
			try { await this.block.execute(); }
			catch (e) {
				if (e instanceof BreakException) break;
				if (e instanceof ContinueException) continue;
				else throw e;
			}
			if (this.increment) await this.increment.execute();
			if (this.condition) condition = await this.condition.execute();
		}
		if (count >= MAX_LOOP_ITERATIONS)
			throw new CodeError(Language.main.errors.MLI, [ this.condition.start, this.condition.end ]);
		Environment.close();
	}

}

class BreakException { }
class Break extends Statement {
	constructor(keyword) {
		super(keyword.position, keyword.position + keyword.lexeme.length);
		this.keyword = keyword;
	}
	async execute() { throw new BreakException(); }
}

class ContinueException { }
class Continue extends Statement {
	constructor(keyword) {
		super(keyword.position, keyword.position + keyword.lexeme.length);
		this.keyword = keyword;
	}
	async execute() { throw new ContinueException(); }
}

class Cout extends Statement {
	static print = console.log;
	constructor(c, expressions) {
		super(expressions[0].start, expressions.top().end);
		this.expressions = expressions;
		this.c = c;
	}
	async execute() {
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
	constructor(c, expressions) {
		super(expressions[0].start, expressions.top().end);
		this.expressions = expressions;
		this.c = c;
	}
	async execute() {
		for (const e of this.expressions) {
			let value = Cin.input_queue.shift() || await Cin.prompt();
			const id = Environment.current.get(e.name);
			if (Cin.input_queue.length === 0 && id.type !== "string") {
				const chunks = value.split(/[\s\n\r]+/gm);
				if (chunks.length > 1) {
					value = chunks.shift();
					Cin.input_queue.push(...chunks);
				} else value = chunks[0];
			}
			switch (id.type) {
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
			Environment.current.assign(e.name, id); // just to notify change
		}
	}
}
