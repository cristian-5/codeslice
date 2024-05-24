
// ==== Values =================================================================

class Value {
	constructor(value, type = "int") {
		this.value = value;
		this.type = type;
	}
	toString() {
		if (this.type === "char") return String.fromCharCode(this.value);
		return this.value.toString();
	}
}

class Environment {

	static current = undefined;

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
			throw new CodeError(Errors.VRD, token.position, token.lexeme.length, [ token.lexeme ]);
		this.values.set(token.lexeme, value);
	}

	assign(token, value) {
		if (this.values.has(token.lexeme)) this.values.set(token.lexeme, value);
		else if (this.parent) this.parent.assign(token, value);
		else throw new CodeError(Errors.UVR, token.position, token.lexeme.length, [ token.lexeme ]);
	}

	get(token) {
		if (this.values.has(token.lexeme)) return this.values.get(token.lexeme);
		if (this.parent) return this.parent.get(token);
		throw new CodeError(Errors.UVR, token.position, token.lexeme.length, [ token.lexeme ]);
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
		const value = structuredClone(await this.right.execute());
		const id = Environment.current.get(this.left.name);
		if (id.type !== value.type)
			throw new CodeError(Errors.CST, this.start, this.end - this.start, [
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
			default: throw new CodeError(Errors.LIT, this.start, this.end - this.start, [ this.value ]);
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
			throw new CodeError(Errors.INI, this.left.start, this.left.end - this.left.start);
		if (r.value === undefined)
			throw new CodeError(Errors.INI, this.right.start, this.right.end - this.right.start);
		if ([ '/', '%' ].includes(this.operator.lexeme) && r.value === 0)
			throw new CodeError(Errors.DBZ, this.right.start, this.right.end - this.right.start);
		let key = l.type + this.operator.lexeme + r.type;
		if (key in InfixExpression.#check)
			return InfixExpression.#check[key](l, r);
		key = r.type + this.operator.lexeme + l.type;
		if (key in InfixExpression.#check)
			return InfixExpression.#check[key](r, l);
		throw new CodeError(Errors.UOB, this.operator.position,
			this.operator.lexeme.length, [
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
	async execute() { // TODO: fix increment and decrement (mutation)
		const r = await this.right.execute();
		if (r.value === undefined)
			throw new CodeError(Errors.INI, this.right.start, this.right.end - this.right.start);
		let key = this.operator.lexeme + r.type;
		if (key in PrefixExpression.#check)
			return PrefixExpression.#check[key](r);
		throw new CodeError(Errors.UPO, o.position, o.lexeme.length, [
			this.operator.lexeme, r.type
		]);
	}
}

class PostfixExpression extends Expression {
	constructor(left, operator) {
		super(left.start, operator.end);
		this.left = left;
		this.operator = operator;
	}
}

class Call extends Expression {
	constructor(callee, lpar, rpar, args) {
		super(callee.start, rpar.position + 1);
		this.callee = callee;
		this.lpar = lpar;
		this.rpar = rpar;
		this.args = args;
	}
}

class Subscript extends Expression {
	constructor(left, index, expression) {
		super(left.start, expression ? expression.end : index.end);
		this.left = left;
		this.index = index;
		this.expression = expression;
	}
	async execute() {

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
	constructor(type, identifier, expression) {
		super(type.position, expression ? expression.end :
			identifier.position + identifier.lexeme.length);
		this.identifier = identifier;
		this.type = type;
		this.expression = expression;
		this.size = 1;
	}
	async execute() {
		let value;
		if (this.expression) {
			value = await this.expression.execute();
			console.log(value);
			if (value.type !== this.type.lexeme)
				throw new CodeError(Errors.CST, this.start, this.end - this.start, [
					this.type.lexeme, value.type
				]);
		} else if (this.size > 1) {
			value = new Value(new Array(this.size), this.type.lexeme);
		} else value = new Value(undefined, this.type.lexeme);
		Environment.current.define(this.identifier, value);
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
		if (await this.condition.execute().value) await this.then.execute();
		else if (this.els) await this.els.execute();
	}

}

class Cout extends Statement {
	static print = console.log;
	constructor(c, expressions) {
		super(expressions[0].start, expressions[expressions.length - 1].end);
		this.expressions = expressions;
		this.c = c;
	}
	async execute() {
		for (const e of this.expressions) {
			const data = await e.execute();
			if (data.value === undefined)
				throw new CodeError(Errors.INI, e.start, e.end - e.start);
			Cout.print(data.toString());
		}
	}
}

class Cin extends Statement {
	static prompt = async () => prompt();
	static input_queue = [];
	constructor(c, expressions) {
		super(expressions[0].start, expressions[expressions.length - 1].end);
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
					if (isNaN(id.value)) throw new CodeError(Errors.CII, e.start, e.end - e.start, [ id.type ]);
				break;
				case "float":
					id.value = parseFloat(value);
					if (isNaN(id.value)) throw new CodeError(Errors.CII, e.start, e.end - e.start, [ id.type ]);
				break;
				case "char":
					id.value = value.charCodeAt(0);
					if (value.length !== 1) throw new CodeError(Errors.CII, e.start, e.end - e.start, [ id.type ]);
				break;
				case "string": id.value = value; break;
				case "bool":
					if (value === "true" || value == 1) id.value = true;
					else if (value === "false" || value == 0) id.value = false;
					else throw new CodeError(Errors.CII, e.start, e.end - e.start, [ id.type ]);
				break;
				default: throw new CodeError(Errors.CIT, e.start, e.end - e.start, [ id.type ]);
			}
		}
	}
}
