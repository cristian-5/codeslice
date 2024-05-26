
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

let AST = null;

async function compile(show_error = false) {
	const code = editor.getValue();
	localStorage.setItem("code", code);
	if (show_error) terminal.reset();
	monaco.editor.setModelMarkers(editor.getModel(), "owner", []);
	AST = null;
	try {
		const parser = new Parser(code);
		AST = await parser.parse();
	} catch (e) {
		AST = null;
		if (!(e instanceof CodeError)) {
			console.error(e);
			return;
		}
		if (show_error) terminal.write(e.colorful_message);
		monaco.editor.setModelMarkers(editor.getModel(), "owner", [{
			startLineNumber: e.position[0], startColumn: e.position[1],
			endLineNumber: e.position[0], endColumn: e.position[1] + e.position[3],
			message: e.message, severity: monaco.MarkerSeverity.Error
		}]);
	}
}

async function run() {
	await compile(true);
	terminal.reset();
	document.getElementById("debug").innerHTML = ""; // clear debug view
	try { await AST.execute(); } catch (e) {
		if (!(e instanceof CodeError)) {
			console.error(e);
			return;
		}
		terminal.write(e.colorful_message);
		monaco.editor.setModelMarkers(editor.getModel(), "owner", [{
			startLineNumber: e.position[0], startColumn: e.position[1],
			endLineNumber: e.position[0], endColumn: e.position[1] + e.position[3],
			message: e.message, severity: monaco.MarkerSeverity.Error
		}]);
	}
}

Cout.print = text => terminal.write(text);
Cin.prompt = async () => {
	terminal.input_enabled = true;
	while (!terminal.input_ready) await wait(100);
	terminal.input_enabled = terminal.input_ready = false;
	const data = terminal.input_data.trim();
	terminal.input_data = "";
	return data;
};

Environment.on_define = async (id, data) => {
	switch (data.dimensions) {
		case 1:
			document.getElementById("debug").innerHTML += `
			<div class="variable ${data.base}"><table class="array" data-id="${id}">
				<tr><th colspan="${data.sizes[0]}">${id}</th></tr>
				<tr>${Array.from({ length: data.sizes[0] }).map((_, i) => `
					<td title="(${i})">${data.value[i] === undefined ?
						'<span style="color:rgba(255,255,255,0.3)">?</span>' :
						data.value[i]}
					</td>
				`).join('')}</tr>
			</table></div>`;
		return;
		case 2:
			document.getElementById("debug").innerHTML += `
			<div class="variable ${data.base}"><table class="array" data-id="${id}">
				<tr><th colspan="${data.sizes[0]}">${id}</th></tr>
				${Array.from({ length: data.sizes[0] }).map((_, i) => `
					<tr>${Array.from({ length: data.sizes[1] }).map((_, j) => `
						<td title="(${i}, ${j})">${data.value[i][j] === undefined ?
							'<span style="color:rgba(255,255,255,0.3)">?</span>'
							: data.value[i][j]}
						</td>
					`).join('')}</tr>
				`).join('')}
			</table></div>`;
		return;
	}
	switch (data.type) {
		case "int": case "float": case "string": case "bool":
			document.getElementById("debug").innerHTML += `
			<div class="variable ${data.type}"><table data-id="${id}" data-assigned="false">
				<tr><th>${id}</th></tr>
				<tr><td>${ data.value === undefined ?
					'<span style="color:rgba(255,255,255,0.3)">?</span>' : data.value
				}</td></tr>
			</table></div>`;
		break;
	}
};

Environment.on_change = async (id, data) => {
	const last = document.querySelector(`.variable > table[data-assigned="true"]`);
	if (last) last.setAttribute("data-assigned", "false");
	const variable = document.querySelector(`.variable > table[data-id="${id}"]`);
	if (variable) variable.querySelector("td").textContent = (
		data.value === undefined ? '?' : data.value
	);
	variable.setAttribute("data-assigned", "true");
};
