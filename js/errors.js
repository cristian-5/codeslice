
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
		if (parameters) message = this.#unravel(message, parameters);
		this.message = this.#error(message, this.#line(position, code));
	}

}

const EN_Errors = {
	// ==== Lexer errors =============================
	MTC: "Missing terminating ' character",
	MTS: "Missing terminating \" character",
	UES: "Unknown escape sequence",
	ICL: "Invalid character literal",
	UNC: "Unexpected character",
	// ==== Parser errors ============================
	EXT: "Expected missing %",
	EXM: "Expected missing % \"%\"",
	// ==== Runtime errors ===========================
	DBZ: "Division by zero",
	VRD: "Variable redefinition %",
	UVR: "Undefined variable %",
	UEX: "Unexpected expression",
	UOB: "Unsupported binary infix operator % on % and %",
	UPO: "Unsupported unary prefix operator % on %",
	UPP: "Unsupported unary postfix operator % on %",
	NMT: "Invalid assignment of non matching types % and %",
	IAT: "Invalid assignment to %",
	COU: "Expected << after cout",
	CIN: "Expected >> after cin",
	LIT: "Invalid literal %",
	CII: "Invalid cin input for type %",
	CIT: "Invalid cin type %",
	CST: "Incompatible types % and % require casting",
	CIX: "Invalid cin expression",
	INI: "Use of unititialized variable",
};

let Errors = EN_Errors;