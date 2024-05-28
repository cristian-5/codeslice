
class Language {

	static #languages = {
		"EN": {
			errors: {
				// ==== Lexer errors =============================
				MTC: "Missing terminating % character",
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
				INI: "Use of unititialized memory area",
				ASI: "Array sizes must be of int type but % found",
				AS0: "Array size must be greater than 0 but % found",
				SNA: "Subscript not allowed for non-array expression",
				ISD: "Invalid subscription dimensions, expected % but % found",
				IST: "Invalid subscription type, expected int but % found",
				IOB: "Index % out of bounds",
				BOO: "Expected bool expression but % found",
				MLI: "Max loop iterations exceeded",
			},
			saveMessage: "🍰 Code SL/CE automatically saves your changes!",
			loveMessage: "Made with ❤️ by <b>Prof. Cristian Antonuccio</b>",
		},
		"IT": {
			errors: {
				// ==== Lexer errors =============================
				MTC: "Carattere di chiusura % mancante",
				UES: "Sequenza di escape sconosciuta",
				ICL: "Carattere non valido",
				UNC: "Carattere inaspettato",
				// ==== Parser errors ============================
				COU: "Necessario << dopo cout",
				CIN: "Necessario >> dopo cin",
				EXT: "Token % mancante",
				EXM: "Token % \"%\" mancante",
				UFN: "Funzione % inaspettata",
				FNF: "La funzione % non accetta gli argomenti forniti",
				// ==== Runtime errors ===========================
				DBZ: "Divisione per zero",
				VRD: "Ridefinizione di variabile %",
				UVR: "Variabile % non definita",
				UEX: "Espressione inaspettata",
				UOB: "Operatore binario % non supportato tra % e %",
				UPO: "Operatore unario prefisso % non supportato su %",
				UPP: "Operatore unario postfisso % non supportato su %",
				IAT: "Destinazione di assegnamento non valida",
				LIT: "Letterale non valido %",
				CII: "Input cin non valido per tipo %",
				CIT: "Tipo cin non valido %",
				CST: "Tipi incompatibili % e % richiedono il casting",
				CIX: "Espressione cin non valida",
				INI: "Utilizzo di un'area di memoria non inizializzata",
				ASI: "Dimensioni di array devono essere di tipo int non %",
				AS0: "Dimensione di array deve essere maggiore di 0 non %",
				SNA: "Sottoscrizione non consentita per espressione non-array",
				ISD: "Dimensioni di array non valide, attese % non %",
				IST: "Tipo di sottoscrizione non valido, atteso int non %",
				IOB: "Indice % fuori dai limiti",
				BOO: "Espressione booleana attesa ma trovato %",
				MLI: "Superato il numero massimo di iterazioni",
			},
			saveMessage: "🍰 Code SL/CE salva automaticamente le modifiche!",
			loveMessage: "Fatto con ❤️ dal <b>Prof. Cristian Antonuccio</b>",
		},
	};

	static current = "EN";

	static get main() { return Language.#languages[Language.current]; }

};
