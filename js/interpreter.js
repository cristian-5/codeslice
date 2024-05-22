
Array.prototype.top = function() { return this[this.length - 1]; };

const digit = c => c >= '0' && c <= '9';
const letter = c =>(c >= 'a' && c <= 'z') ||
	(c >= 'A' && c <= 'Z') || c === '_';
const alpha = c => digit(c) || letter(c);

const escapedChars = {
	'\\\\': "\\", '\\\'': '\'', '\\"': '"',
	'\\n': "\n", '\\t': "\t", '\\r': "\r", '\\0': "\0"
};

const types = [ "int", "float", "char", "string", "bool" ];
const keywords = [
	"cout", "cin", "endl",
	"if", "else", "while", "for", "do", "switch", "case", "default",
	"break", "continue", "return", "using", "namespace",
	"true", "false",
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
	// ==== Runtime errors ===========================
	"VRD": "Variable redefinition %",
	"UVR": "Undefined variable %",
	"UEX": "Unexpected expression",
	"UOB": "Unsupported binary operator '%' on % and %",
	"UOU": "Unsupported unary operator '%' on %",
	"NMT": "Invalid assignment of non matching types % and %",
};

class CodeError {

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

class Environment {
	
	constructor(parent) {
		this.parent = parent;
		this.values = new Map();
	}

	define(token, value) {
		if (this.values.has(token.lexeme))
			throw new CodeError("VRD", token.position, token.lexeme.length, this.code, [ token.lexeme ]);
		this.values.set(token.lexeme, value);
	}

	assign(token, value) {
		if (this.values.has(token.lexeme)) this.values.set(token.lexeme, value);
		else if (this.parent) this.parent.assign(token.lexeme, value);
		else throw new CodeError("UVR", token.position, token.lexeme.length, this.code, [ token.lexeme ]);
	}

	get(token) {
		if (this.values.has(token.lexeme)) return this.values.get(token.lexeme);
		if (this.parent) return this.parent.get(token.lexeme);
		throw new CodeError("UVR", token.position, token.lexeme.length, this.code, [ token.lexeme ]);
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
		"int-char":   (a, b) => new Value(a.value - b.value, "int"),
		"int-float":  (a, b) => new Value(a.value - b.value, "float"),
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

	static #unary = {
		"-int": a => new Value(-a.value, "int"),
		"-char": a => new Value(- a.value, "int"),
		"-float": a => new Value(-a.value, "float"),
		"!bool": a => new Value(!a.value, "bool"),
		"~int": a => new Value(~a.value, "int"),
		"~char": a => new Value(~a.value, "int"),
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
		throw new CodeError("UOB", o.position, o.lexeme.length, this.code, [
			o.lexeme, a.type, b.type
		]);
	}

	static unary(o, a) {
		let key = o.lexeme + a.subtype;
		if (key in Value.#unary) return Value.#unary[key](a);
		throw new CodeError("UOU", o.position, o.lexeme.length, this.code, [
			o.lexeme, a.type
		]);
	}

}

class Interpreter {

	constructor(code) {
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
		if (l) throw new CodeError("EXM", position, 1, this.code, [ t, l ]);
		throw new CodeError("EXT", position, 1, this.code, [ t ]);
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
					if (code[i] == '\n') throw new CodeError("MTS", position, t.length, code);
					tokens.push({ lexeme: t + '"', type: "string", position });
				break;
				case '\'':
					position = i; i++; t = "\'";
					while (i < code.length && code[i] !== '\'' && code[i] !== '\n')
						t += code[i++];
					if (code[i] == '\n') throw new CodeError("MTC", position, t.length, code);
					t += "'";
					if (t.length !== 1) {
						if (t.includes('\\')) {
							const c = t.substring(1, t.length - 1);
							if (!(c in escapedChars)) throw new CodeError("UES", position, t.length, code);
							else tokens.push({ lexeme: `'${escapedChars[c]}'`, type: "char", position });
						} else throw new CodeError("ICL", position, t.length, code);
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
					} else throw new CodeError("UNC", position, 1, code);
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

	// <program> := { <block> }
	#program() {
		this.variables = new Environment();
		while (!this.#end()) return this.#block();
	}
	// <declaration> := <type> <identifier> [ '=' <expression> ] ';'
	#declaration() {
		const type = this.#consume("type").lexeme;
		const id = this.#consume("identifier").lexeme;
		if (this.#match("operator", "=")) {
			const value = this.#expression();
			if (value.type !== type)
				throw new CodeError("UVR", value.position, value.lexeme.length, this.code, [ id ]);
			this.variables.set(id, value);
		}
		this.#consume("operator", ";");
	}
	// <block> := '{' { <statement> } '}'
	#block() {
		if (this.#match("operator", '{')) {


			this.#consume("operator", '}');
		} else this.#statement();
	}
	// <statement> := <declaration> | <expression> ';'
	#statement() {
		if (this.#check("type")) this.#declaration();
		else this.#expression();
		this.#consume("operator", ";");
		/*if (this.#check("keyword", "if"))     return this.#if();
		if (this.#check("keyword", "while"))  return this.#while();
		if (this.#check("keyword", "for"))    return this.#for();
		if (this.#check("keyword", "do"))     return this.#do();
		if (this.#check("keyword", "switch")) return this.#switch();*/
	}

	// ==== Expressions ========================================================

	// <expression> := <assignment>
	#expression() { return this.#assignment(); }
	// <assignment> := <identifier> ( '=' <expression> ) | <term>
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
	// <term> := <factor> ( ( '+' | '-' ) <factor> )*
	#term() {
		let e = this.#factor();
		while (this.#match("operator", "+") || this.#match("operator", "-")) {
			e = Value.binary(e, this.#previous().lexeme, this.#factor());
		}
		return e;
	}
	// <factor> := <prefix> ( ( '*' | '/' | '%' ) <prefix> )*
	#factor() {
		let e = this.#prefix();
		while (this.#match("operator", "*") || this.#match("operator", "/") || this.#match("operator", "%")) {
			e = Value.binary(e, this.#previous().lexeme, this.#prefix());
		}
		return e;
	}
	// <prefix> := ( '+' | '-' ) <prefix> | <primary>
	#prefix() {
		if (this.#match("operator", "+") || this.#match("operator", "-")) {
			return Value.unary(this.#previous().lexeme, this.#prefix());
		} else if (this.#match("operator", "++") || this.#match("operator", "--")) {
			// TODO: implement prefix increment and decrement;
		}
		return this.#primary();
	}
	// <primary> := '(' <expression> ')' | <identifier> | <number> | <string> | <char> | <bool>
	#primary() {
		if (this.#match("operator", "(")) {
			const e = this.#expression();
			this.#consume("operator", ")");
			return e;
		} else if (this.#check("identifier")) {
			const name = this.#advance();
			return this.variables.get(name);
		} else if (this.#check("number")) {
			const n = this.#advance();
			if (n.lexeme.includes('.')) return new Value(parseFloat(n.lexeme), "float");
			return new Value(parseInt(n.lexeme), "int");
		} else if (this.#check("string")) {
			const s = this.#advance();
			return new Value(s.lexeme.substring(1, s.lexeme.length - 1), "string");
		} else if (this.#check("char")) {
			const c = this.#advance();
			return new Value(c.lexeme.charCodeAt(1), "char");
		}
		else if (this.#match("keyword", "true"))  return new Value(true,  "bool");
		else if (this.#match("keyword", "false")) return new Value(false, "bool");
		const p = this.#peek();
		throw new CodeError("UEX", p.position, p.lexeme.length, this.code);
	}

	run() {
		if (this.tokens.length === 0) return;
		this.current = 0;
		

		this.#program();
	}

}
