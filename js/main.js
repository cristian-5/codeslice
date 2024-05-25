
const theme = {
	light: { background: "#FFFFFF", foreground: "#000000", cursor: "#000000", cursorAccent: "#FFFFFF" },
	dark: { background: "#000000", foreground: "#FFFFFF", cursor: "#FFFFFF", cursorAccent: "#000000" }
};

function darkMode() {
	return window.matchMedia && window.matchMedia(
		"(prefers-color-scheme: dark)"
	).matches;
}

window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", e => {
	editor.updateOptions({ theme: e.matches ? "vs-dark" : "vs" });
	terminal.options.theme = structuredClone(e.matches ? theme.dark : theme.light);
});

const wait = ms => new Promise(r => setTimeout(() => r(true), ms));

async function run() {
	const code = editor.getValue();
	localStorage.setItem("code", code);
	terminal.reset();
	Cout.print = text => terminal.write(text);
	Cin.prompt = async line => {
		terminal.input_enabled = true;
		while (!terminal.input_ready) await wait(100);
		terminal.input_enabled = terminal.input_ready = false;
		const data = terminal.input_data.trim();
		terminal.input_data = "";
		return data;
	};
	try {
		const interpreter = new Interpreter(code);
		await interpreter.run();
	} catch (e) {
		if (!(e instanceof CodeError)) {
			console.error(e);
			return;
		}
		terminal.write(e.colorful_message);
		console.log(e.message);
		monaco.editor.setModelMarkers(editor.getModel(), "owner", [{
			startLineNumber: e.position[0], startColumn: e.position[1],
			endLineNumber: e.position[0], endColumn: e.position[1] + e.position[3],
			message: e.message, severity: monaco.MarkerSeverity.Error
		}]);
	}
}
