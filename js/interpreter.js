
Array.prototype.top = function() { return this[this.length - 1]; };

const digit = c => c >= '0' && c <= '9';
const letter = c =>(c >= 'a' && c <= 'z') ||
	(c >= 'A' && c <= 'Z') || c === '_';
const alpha = c => digit(c) || letter(c);

const escapedChars = {
	'\\\\': "\\", '\\\'': '\'', '\\"': '"',
	'\\n': "\n", '\\t': "\t", '\\r': "\r", '\\0': "\0"
};

const types = [
	"int", "float", "double", "char", "string", "bool", "short",
	"void", "long", "unsigned",
];
const keywords = [
	"if", "else", "while", "for", "do", "switch", "case", "default",
	"break", "continue", "return", "using", "namespace"
];

const Errors = {
	// ==== Lexer errors =============================
	"MTC": "Missing terminating ' character",
	"MTS": "Missing terminating \" character",
	"UES": "Unknown escape sequence",
	"ICL": "Invalid character literal",
	"UNC": "Unexpected character",
	// ==== Parser errors ============================
	"EXT": "Expected missing %",
	"EXM": "Expected missing % \"%\"",
	"IPD": "Invalid preprocessor directive",
	"LIB": "Unknown library \"%\"",
	"UNS": "Unknown namespace \"%\"",
	// ==== Runtime errors ===========================
	"VRD": "Variable redefinition %",
	"UVR": "Undefined variable %",
	"UEX": "Unexpected expression",
	"UOB": "Unsupported binary operator '%' on % and %",
	"UOU": "Unsupported unary operator '%' on %",
};

class SyntaxError {

	#where(position, length, code) {
		let row = 1, col = 1, app = 0;
		for (let i = 0; i < position; i++) {
			if (code[i] === '\n') { row++; col = 1; app = 0; }
			else {
				col++;
				if (code[i] === '\t') app += 4;
				else app++;
			}
		}
		return [ row, col, app, length ];
	}

	#line(at, code) {
		if (at < 0 || at >= code.length) return "";
		if (code[at] === '\n') at--;
		let start = at, end = at;
		while (start > 0 && code[start] !== '\n') start--;
		while (end < code.length && code[end] !== '\n') end++;
		return code.substring(start, end);
	}

	#error(message, line) {
		const [ row, col, app, len ] = this.position;
		return [
			`\x1b[1m[${row}:${col}] \x1b[91merror:\x1b[0m\x1b[1m ${message}\x1b[0m`,
			line.replace(/\t/g, "     ").replace(/^\n+/g, ''),
			len == 1 ? ' '.repeat(app) + "\x1b[91m^\x1b[0m\n" :
				' '.repeat(app) + "\x1b[91m" + '~'.repeat(len) + '\x1b[0m\n'
		].join('\n');
	}

	#unravel(message, parameters) {
		let i = 0;
		return message.replace(/%/g, _ => parameters[i++]);
	}

	constructor(message, position, length, code, parameters) {
		this.position = this.#where(position, length, code);
		message = parameters ? this.#unravel(Errors[message], parameters) : Errors[message];
		this.message = this.#error(message, this.#line(position, code));
	}

}

class Function {

	constructor(type, name, parameters, body) {
		this.type = type;
		this.name = name;
		this.parameters = parameters;
		this.body = body;
	}

	call(parameters) {
	}

}

class Environment {
	
	constructor(parent) {
		this.parent = parent;
		this.values = new Map();
	}

	define(token, value) {
		if (this.values.has(token.lexeme))
			throw new SyntaxError("VRD", token.position, token.lexeme.length, this.code, [ token.lexeme ]);
		this.values.set(token.lexeme, value);
	}

	assign(token, value) {
		if (this.values.has(token.lexeme)) this.values.set(token.lexeme, value);
		else if (this.parent) this.parent.assign(token.lexeme, value);
		else throw new SyntaxError("UVR", token.position, token.lexeme.length, this.code, [ token.lexeme ]);
	}

	get(token) {
		if (this.values.has(token.lexeme)) return this.values.get(token.lexeme);
		if (this.parent) return this.parent.get(token.lexeme);
		throw new SyntaxError("UVR", token.position, token.lexeme.length, this.code, [ token.lexeme ]);
	}

}

class Value {

	static #binary = {
		"string+string": (a, b) => new Value(a.value + b.value, "string"),
		"string==string": (a, b) => new Value(a.value === b.value, "bool"),
		"string!=string": (a, b) => new Value(a.value !== b.value, "bool"),
		"int+int":    (a, b) => new Value(a.value + b.value, "int"),
		"int+float":  (a, b) => new Value(a.value + b.value, "float"),
		"int-int":    (a, b) => new Value(a.value - b.value, "int"),
		"int-float":  (a, b) => new Value(a.value - b.value, "float"),
		"int*int":    (a, b) => new Value(a.value * b.value, "int"),
		"int*float":  (a, b) => new Value(a.value * b.value, "float"),
		"int/int":    (a, b) => new Value(Math.floor(a.value / b.value), "int"),
		"int/float":  (a, b) => new Value(a.value / b.value, "float"),
		"int%int":    (a, b) => new Value(a.value % b.value, "int"),
		"int&int":    (a, b) => new Value(a.value & b.value, "int"),
		"int|int":    (a, b) => new Value(a.value | b.value, "int"),
		"float+float": (a, b) => new Value(a.value + b.value, "float"),
		"float-float": (a, b) => new Value(a.value - b.value, "float"),
		"float*float": (a, b) => new Value(a.value * b.value, "float"),
		"float/float": (a, b) => new Value(a.value / b.value, "float"),
		"bool&&bool": (a, b) => new Value(a.value && b.value, "bool"),
		"bool||bool": (a, b) => new Value(a.value || b.value, "bool"),
		"bool==bool": (a, b) => new Value(a.value === b.value, "bool"),
		"bool!=bool": (a, b) => new Value(a.value !== b.value, "bool"),
		"char+char": (a, b) => new Value(a.value + b.value, "char"),
		"char+int":  (a, b) => new Value(a.value + b.value, "char"),
		"char-int":  (a, b) => new Value(a.value - b.value, "char"),
		"char*int":  (a, b) => new Value(a.value * b.value, "char"),
		"char/int":  (a, b) => new Value(Math.floor(a.value / b.value), "char"),
		"char%int":  (a, b) => new Value(a.value % b.value, "char"),
		"int%char":  (a, b) => new Value(a.value % b.value, "char"),
		"int/char":  (a, b) => new Value(Math.floor(a.value / b.value), "int"),
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

	static #prefix = {
		"-int": a => new Value(-a.value, "int"),
		"-float": a => new Value(-a.value, "float"),
		"!bool": a => new Value(!a.value, "bool"),
	};

	constructor(value, type = "int") {
		this.value = value;
		this.type = type;
		switch (type) {
			case "long": case "short": case "unsigned":
				this.subtype = "int";
			break;
			case "float": case "double":
				this.subtype = "float";
			default: this.subtype = type;
		}
	}

	static binary(a, o, b) {
		let key = a.subtype + o.lexeme + b.subtype;
		if (key in Value.#binary) return Value.#binary[key](a, b);
		key = b.subtype + o + a.subtype;
		if (key in Value.#binary) return Value.#binary[key](b, a);
		throw new SyntaxError("UOB", o.position, o.lexeme.length, this.code, [
			o.lexeme, a.type, b.type
		]);
	}

	static prefix(o, a) {
		let key = o.lexeme + a.subtype;
		if (key in Value.#prefix) return Value.#prefix[key](a);
		throw new SyntaxError("UOU", o.position, o.lexeme.length, this.code, [
			o.lexeme, a.type
		]);
	}

}

class Interpreter {

	constructor(code = "") {
		this.code = code.replace(/\r/g, ""); // CRLF to LF
		this.tokens = this.#lex();
	}

	#advance() { return this.tokens[this.current++]; }
	#previous() { return this.tokens[this.current - 1]; }
	#peek() { return this.tokens[this.current]; }
	#end() { return this.current >= this.tokens.length; }
	#check(type, lexeme) {
		if (this.#end()) return false;
		const p = this.#peek();
		if (lexeme) return p.type === type && p.lexeme === lexeme;
		else return p.type === type;
	}
	#match(t, l) { return this.#check(t, l) ? !!this.#advance() : false; }
	#consume(t, l) {
		if (this.#match(t, l)) return this.#previous();
		const prev = this.#previous() || { position: 0, lexeme: "" };
		const position = prev.position + prev.lexeme.length;
		if (l) throw new SyntaxError("EXM", position, 1, this.code, [ t, l ]);
		throw new SyntaxError("EXT", position, 1, this.code, [ t ]);
	}

	// ==== Lexer ==============================================================

	#lex() {
		const code = this.code;
		let tokens = [], grouped = []; let i = 0, t = "", position = 0;
		while (i < code.length) {
			switch (code[i]) {
				case ' ': case '\t': case '\n': break;
				case '+': case '-': case '*': case '/':
				case '%': case '=': case '(': case ')':
				case '{': case '}': case ';': case ',':
				case '<': case '>': case '!': case ':':
				case '[': case ']': case '&': case '|':
					tokens.push({ lexeme: code[i], type: "operator", position: i });
				break;
				case '#':
					position = i; i++; t = "#";
					while (i < code.length && code[i] !== '\n')
						t += code[i++];
					tokens.push({ lexeme: t, type: "directive", position });
				break;
				case '"':
					position = i; i++; t = '"';
					while (i < code.length && code[i] !== '"' && code[i] !== '\n')
						t += code[i++];
					if (code[i] == '\n') throw new SyntaxError("MTS", position, t.length, code);
					tokens.push({ lexeme: t + '"', type: "string", position });
				break;
				case '\'':
					position = i; i++; t = "\'";
					while (i < code.length && code[i] !== '\'' && code[i] !== '\n')
						t += code[i++];
					if (code[i] == '\n') throw new SyntaxError("MTC", position, t.length, code);
					t += "'";
					if (t.length !== 1) {
						if (t.includes('\\')) {
							const c = t.substring(1, t.length - 1);
							if (!(c in escapedChars)) throw new SyntaxError("UES", position, t.length, code);
							else tokens.push({ lexeme: `'${escapedChars[c]}'`, type: "char", position });
						} else throw new SyntaxError("ICL", position, t.length, code);
					} else tokens.push({ lexeme: t, type: "char", position });
				break;
				default:
					position = i;
					if (digit(code[i])) {
						t = "";
						while (i < code.length && digit(code[i]) || code[i] === '.')
							t += code[i++];
						tokens.push({ lexeme: t, type: "number", position });
					} else if (letter(code[i])) {
						t = "";
						while (i < code.length && alpha(code[i])) t += code[i++];
						if (types.includes(t)) tokens.push({ lexeme: t, type: "type", position });
						else if (keywords.includes(t)) tokens.push({ lexeme: t, type: "keyword", position });
						else tokens.push({ lexeme: t, type: "identifier", position });
					} else throw new SyntaxError("UNC", position, 1, code);
					i--;
				break;
			}
			i++;
		}
		// group tokens like !=, ==, <=, >=, etc:
		for (let i = 0; i < tokens.length - 1; i++) {
			if (tokens[i].type !== "operator") {
				grouped.push(tokens[i]);
				continue;
			}
			switch (tokens[i].lexeme) {
				case '=': case '!': case '*': case '/': case '%':
					if (tokens[i + 1].lexeme === '=') {
						grouped.push({
							lexeme: tokens[i].lexeme + tokens[i + 1].lexeme,
							type: "operator", position: tokens[i].position
						});
						i++;
					} else grouped.push(tokens[i]);
				break;
				case ':':
					if (tokens[i + 1].lexeme === ':') {
						grouped.push({
							lexeme: tokens[i].lexeme + tokens[i + 1].lexeme,
							type: "operator", position: tokens[i].position
						});
						i++;
					} else grouped.push(tokens[i]);
				break;
				case '&': case '|': case '<': case '>': case '+': case '-':
					if (tokens[i + 1].lexeme === '=' || tokens[i + 1].lexeme === tokens[i].lexeme) {
						grouped.push({
							lexeme: tokens[i].lexeme + tokens[i + 1].lexeme,
							type: "operator", position: tokens[i].position
						});
						i++;
					} else grouped.push(tokens[i]);
				break;
				default: grouped.push(tokens[i]);
			}
		}
		if (tokens.length > 0) grouped.push(tokens[tokens.length - 1]);
		return grouped;
	}

	// ==== Parser =============================================================

	#program() {
		this.variables = new Environment();
		this.functions = new Map(); // name: { type, parameters, body }
		while (!this.#end()) {
			if (this.#check("directive")) this.#directive();
			else if (this.#check("keyword", "using")) this.#using();
			else if (this.#check("type")) this.#declaration();
			//else this.#function(); // or global variable declaration
		}
	}

	#directive() {
		const d = this.#consume("directive").lexeme;
		const lib = d.match(/#\s*include\s*[<"]\s*([^\s]+)\s*[>"]\s*\n*/);
		if (!lib) throw new SyntaxError("IPD", d.position, d.lexeme.length, this.code);
		switch (lib[1].toLowerCase()) {
			case "iostream": console.log("iostream"); break;
			case "string": case "string.h": case "cstring": console.log("string"); break;
			case "cmath": case "math.h": console.log("math"); break;
			case "ctime": case "time.h": console.log("time"); break;
			case "cstdlib": case "stdlib.h": console.log("stdlib"); break;
			case "cstdio": case "stdio.h": console.log("stdio"); break;
			default: throw new SyntaxError("LIB", d.position, d.lexeme.length, this.code, [ lib[1] ]);
		}
	}

	#using() {
		this.#consume("keyword", "using");
		if (this.#match("keyword", "namespace")) {
			const ns = this.#consume("identifier");
			switch (ns.lexeme) {
				case "std": console.log("using namespace std"); break;
				default: throw new SyntaxError("UNS", ns.position, ns.lexeme.length, this.code, [ ns.lexeme ]);
			}
		} else {
			const id = this.#consume("identifier");
			if (this.#match("operator", "::")) {
				const ns = this.#consume("identifier");
				console.log(`using ${id.lexeme}::${ns.lexeme}`);
			} else console.log(`using ${id.lexeme}`);
		}
		this.#consume("operator", ";");
	}

	#declaration() {
		const type = this.#consume("type").lexeme;
		const id = this.#consume("identifier").lexeme;
		if (this.#match("operator", "(")) this.#function(type, id);
		else {
			if (this.#match("operator", "=")) {
				const value = this.#expression();
				this.variables.set(id, value);
			}
			this.#consume("operator", ";");
		}
	}

	#function(type, id) {
		const parameters = [];
		if (!this.#match("operator", ")")) {
			do {
				const ptype = this.#consume("type").lexeme;
				const pid = this.#consume("identifier").lexeme;
				parameters.push({ type: ptype, name: pid });
			} while (this.#match("operator", ","));
			this.#consume("operator", ")");
		}
		if (this.#match("operator", ";")) {
			this.functions.set(new Function(type, id, parameters));
			return;
		}
		this.#consume("operator", "{");
		const body = this.#block();
		this.functions.set(id, new Function(type, id, parameters, body));
	}

	#block() {
		const statements = [];
		while (!this.#end() && !this.#check("operator", "}")) {
			statements.push(this.#statement());
		}
	}

	#statement() {
		/*if (this.#check("keyword", "if"))     return this.#if();
		if (this.#check("keyword", "while"))  return this.#while();
		if (this.#check("keyword", "for"))    return this.#for();
		if (this.#check("keyword", "do"))     return this.#do();
		if (this.#check("keyword", "switch")) return this.#switch();*/
	}

	// ==== Expressions ========================================================

	// expression := <assignment>
	#expression() { return this.#assignment(); }
	// assignment := <identifier> ( '=' <expression> ) | <term>
	#assignment() {
		if (this.#match("identifier")) {
			const name = this.#previous();
			if (this.#check("operator", "=")) {
				this.#advance();
				const value = this.#expression();
				this.variables.assign(name, value);
				return value;
			} else { // if it's not an assignment, it's a term
				this.current--;
				return this.#term();
			}
		} else return this.#term();
	}
	// term := <factor> ( ( '+' | '-' ) <factor> )*
	#term() {
		let e = this.#factor();
		while (this.#match("operator", "+") || this.#match("operator", "-")) {
			e = Value.binary(e, this.#previous().lexeme, this.#factor());
		}
		return e;
	}
	// factor := <prefix> ( ( '*' | '/' | '%' ) <prefix> )*
	#factor() {
		let e = this.#prefix();
		while (this.#match("operator", "*") || this.#match("operator", "/") || this.#match("operator", "%")) {
			e = Value.binary(e, this.#previous().lexeme, this.#prefix());
		}
		return e;
	}
	#prefix() {
		if (this.#match("operator", "+") || this.#match("operator", "-")) {
			return Value.unary(this.#previous().lexeme, this.#prefix());
		}
		return this.#primary();
	}
	#primary() {
		if (this.#match("operator", "(")) {
			const e = this.#expression();
			this.#consume("operator", ")");
			return e;
		} else if (this.#check("identifier")) {
			const name = this.#advance();
			return this.variables.get(name);
		} else if (this.#check("number")) {
			const n = Number(this.#advance().lexeme);
			return n;
		}
		const p = this.#peek();
		throw new SyntaxError("UEX", p.position, p.lexeme.length, this.code);
	}

	run() {
		if (this.tokens.length === 0) return;
		this.current = 0;
		

		this.#program();
	}

}
