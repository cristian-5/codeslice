
class CodeError {

	static code = "";

	#where(position) {
		const [ start, end ] = position, length = end - start;
		let row = 1, col = 1, app = 0;
		for (let i = 0; i < end - length; i++) {
			if (CodeError.code[i] === '\n') { row++; col = 1; app = 0; }
			else {
				col++;
				app += (CodeError.code[i] === '\t') ? 4 : 1;
			}
		}
		return [ row, col, app, length ];
	}

	#line(at) {
		// given char position "at" return the line
		const code = CodeError.code;
		let start = at, end = at;
		while (start > 0 && code[start - 1] !== '\n') start--;
		while (end < code.length && code[end] !== '\n') end++;
		return code.substring(start, end);
	}

	#error(message, line) {
		const [ row, col, app, len ] = this.position;
		return [
			`\x1b[1m[${row}:${col}] \x1b[91merror:\x1b[0m\x1b[1m ${message}\x1b[0m`,
			line.replace(/\t/g, "    ").replace(/^\n+/g, ''), ' '.repeat(app) + (
				len == 1 ? "\x1b[91m^\x1b[0m\n" : ("\x1b[91m" + '~'.repeat(len) + '\x1b[0m\n')
			)
		].join('\n');
	}

	#unravel(message, parameters) {
		let i = 0;
		return message.replace(/%/g, _ => parameters[i++]);
	}

	constructor(message, position, parameters) {
		if ("position" in position) position = [ // token handling
			position.position, position.position + position.lexeme.length
		];
		this.position = this.#where(position);
		if (parameters) this.message = this.#unravel(message, parameters);
		else this.message = message;
		this.colorful_message = this.#error(this.message, this.#line(position[0]));
	}

}

const EN_Errors = {
	// ==== Lexer errors =============================
	MTC: "Missing terminating % character",
	MTS: "Missing terminating \" character",
	UES: "Unknown escape sequence",
	ICL: "Invalid character literal",
	UNC: "Unexpected character",
	// ==== Parser errors ============================
	COU: "Expected << after cout",
	CIN: "Expected >> after cin",
	EXT: "Expected missing %",
	EXM: "Expected missing % \"%\"",
	UFN: "Unexpected function %",
	FNF: "Function % does not accept the given arguments",
	// ==== Runtime errors ===========================
	DBZ: "Division by zero",
	VRD: "Variable redefinition %",
	UVR: "Undefined variable %",
	UEX: "Unexpected expression",
	UOB: "Unsupported binary infix operator % on % and %",
	UPO: "Unsupported unary prefix operator % on %",
	UPP: "Unsupported unary postfix operator % on %",
	IAT: "Invalid assignment target",
	LIT: "Invalid literal %",
	CII: "Invalid cin input for type %",
	CIT: "Invalid cin type %",
	CST: "Incompatible types % and % require casting",
	CIX: "Invalid cin expression",
	INI: "Use of unititialized variable",
	ASI: "Array sizes must be of int type but % found",
	AS0: "Array size must be greater than 0 but % found",
	SNA: "Subscript not allowed for non-array expression",
	ISD: "Invalid subscription dimensions, expected % but % found",
	IST: "Invalid subscription type, expected int but % found",
	IOB: "Index % out of bounds",
};

let Errors = EN_Errors;