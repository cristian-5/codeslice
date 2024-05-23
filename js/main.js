
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

function wait(ms) { 
	return new Promise(resolve => setTimeout(() => resolve(true), ms));
}

let last_line = "";
function run() {
	const code = editor.getValue();
	localStorage.setItem("code", code);
	terminal.reset();

	
	try {
		const interpreter = new Interpreter(code);
		console.log(interpreter.run());
	} catch (e) {
		terminal.write(e.message);
	}

}
