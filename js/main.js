
const theme = {
	dark: { background: "#000000", foreground: "#FFFFFF", cursor: "#FFFFFF", cursorAccent: "#000000" }
};

document.addEventListener("keydown", e => {
	if (e.key === 's' && (navigator.userAgent.includes('Mac') ? e.metaKey : e.ctrlKey)) {
		e.preventDefault();
		vanillaToast.show(Language.main.saveMessage, { duration: 1000, fadeDuration: 500 });
	}
}, false);

let AST = null;

async function compile(sender = null) {
	const code = editor.getValue();
	localStorage.setItem("code", code);
	if (sender) terminal.reset();
	monaco.editor.setModelMarkers(editor.getModel(), "owner", []);
	AST = null;
	try {
		const parser = new Parser(code);
		AST = await parser.parse();
		new TypeChecker().check(AST);
	} catch (e) {
		AST = null;
		if (!(e instanceof CodeError)) {
			console.error(e);
			return;
		}
		if (sender) {
			terminal.reset();
			terminal.write(e.colorful_message);
		}
		monaco.editor.setModelMarkers(editor.getModel(), "owner", [{
			startLineNumber: e.position[0], startColumn: e.position[1],
			endLineNumber: e.position[0], endColumn: e.position[1] + e.position[3],
			message: e.message, severity: monaco.MarkerSeverity.Error
		}]);
		return;
	}
	if (sender === "client") vanillaToast.show(Language.main.noErrors, { duration: 1000, fadeDuration: 500 });
}

/// Thrown inside a program that was stopped because the student pressed Run again.
class RunStopped { }

// Only one program can run at a time: the interpreter keeps its state in statics
// (Environment.current, Call.depth...), so two programs running together corrupt each
// other (a program waiting at `cin` that wakes up inside the new program's scope). So
// pressing Run stops the program waiting at a `cin` (see Cin.prompt) and starts the new
// one only when the old one has finished unwinding.
let latestRun = 0;     // number of the last time Run was pressed
let executingRun = 0;  // number of the run being executed
let runQueue = Promise.resolve();

function run() {
	const number = ++latestRun;
	return runQueue = runQueue.then(() => execute(number));
}

async function execute(number) {
	if (number !== latestRun) return; // Run was pressed again in the meantime
	executingRun = number;
	await compile("server");
	terminal.reset();
	terminal.input_enabled = terminal.input_ready = false;
	terminal.input_data = "";
	Cin.reset(); // what was typed but not read by the previous run
	resetDebugView();
	if (!AST) return;
	try { await AST.execute(); } catch (e) {
		if (e instanceof RunStopped) return;
		if (!(e instanceof CodeError)) {
			console.error(e);
			return;
		}
		setTimeout(() => { // wait for terminal to flush
			terminal.reset();
			terminal.write(e.colorful_message);
		}, 10);
	}
}

Cout.print = text => terminal.write(text);
Cin.prompt = async () => {
	const mine = executingRun;
	terminal.input_enabled = true;
	while (!terminal.input_ready) {
		await wait(100);
		if (mine !== latestRun) throw new RunStopped(); // Run was pressed again
	}
	terminal.input_enabled = terminal.input_ready = false;
	const data = terminal.input_data; // as typed: cin, getline... decide what the spaces mean
	terminal.input_data = "";
	return data;
};

// system("..."): only the commands of a Windows console that make sense here.
System.run = async command => {
	switch (command.trim().toLowerCase()) {
		case "cls": case "clear":
			terminal.reset();
			return 0;
		case "pause": {
			const mine = executingRun;
			Cout.print(Language.main.pressAnyKey);
			terminal.key_wait = true;
			while (terminal.key_wait) {
				await wait(50);
				if (mine !== latestRun) { terminal.key_wait = false; throw new RunStopped(); }
			}
			Cout.print("\n");
			return 0;
		}
		default:
			Cout.print(Language.main.commandNotRecognized.replace("%", command) + "\n");
		return 1; // unknown command: the shell would fail
	}
};

// ==== Debug view =============================================================
//
// Global variables (and namespace members) sit directly in the view. Every other
// environment is a scope: it is drawn as a dashed box that holds its variables and,
// nested inside, the scopes opened from it (a block inside a function, a loop body
// inside the loop...). A function call is nested where the function was *declared*
// (the globals), not in its caller, because that is all it can see.
//
// The interpreter reports what happens through the Environment hooks below. They only
// update a small model: while the program runs the browser cannot paint anyway (it
// gets control back when the program waits for `cin` and when it ends), so the model
// is drawn once, then, instead of touching the DOM on every iteration of a loop.

const debugModel = { items: [] };  // top level: variables and scopes, in order of creation
const scopeNodes = new Map();      // env.uid -> scope { label, items, parent, keys }
const variableItems = new Map();   // "uid/id" -> variable { id, data }
const mergedItems = new Map();    // merged env.uid -> [ { item, key } ] it put in its parent's box
let renderTimer = null;

function resetDebugView() {
	debugModel.items = [];
	scopeNodes.clear();
	mergedItems.clear();
	variableItems.clear();
	renderDebugView();
}

function scheduleRender() {
	if (renderTimer === null) renderTimer = setTimeout(renderDebugView, 0);
}

function renderDebugView() {
	clearTimeout(renderTimer);
	renderTimer = null;
	document.getElementById("debug").innerHTML = itemsHTML(debugModel.items);
}

/// The list a variable (or a scope) of `env` goes in.
function itemsOf(env) {
	const scope = env.isNamespace ? null : scopeNodes.get(env.uid);
	return scope ? scope.items : debugModel.items;
}

function itemsHTML(items) {
	let result = "";
	for (const item of items) {
		if (item.items && item.items.length === 0) continue; // don't show empty scopes
		result += item.items ? `<div class="scope">
			<div class="scope-label">${escaped(item.label)}</div>
			<div class="scope-content">${itemsHTML(item.items)}</div>
		</div>` : variableHTML(item.id, item.data);
	}
	return result;
}

function variableHTML(id, data) {
	const quote = '<span class="symbol">\'</span>';
	const cell = v => v === undefined ? '<span class="symbol">?</span>' :
		data.base === "char" ? quote + escaped(new Value(v, "char").toString()) + quote :
		escaped(new Value(v, data.base).toString());
	switch (data.dimensions) {
		case 1:
			return `
			<div class="variable ${data.base}"><table class="array" data-id="${id}">
				<tr><th colspan="${data.sizes[0]}">
					<span class="type">${data.base}</span> <b>${id}</b>[${data.sizes[0]}]</th>
				</tr>
				<tr>${Array.from({ length: data.sizes[0] }).map((_, i) => `
					<td title="[${i}]">${cell(data.value[i])}</td>
				`).join('')}</tr>
			</table></div>`;
		case 2:
			return `
			<div class="variable ${data.base}"><table class="array" data-id="${id}">
				<tr><th colspan="${data.sizes[1]}">
					<span class="type">${data.base}</span>
					<b>${id}</b>[${data.sizes[0]}][${data.sizes[1]}]</th>
				</tr>
				${Array.from({ length: data.sizes[0] }).map((_, i) => `
					<tr>${Array.from({ length: data.sizes[1] }).map((_, j) => `
						<td title="[${i}][${j}]">${cell(data.value[i][j])}</td>
					`).join('')}</tr>
				`).join('')}
			</table></div>`;
	}
	switch (data.type) {
		case "int": case "float": case "bool":
			return `
			<div class="variable ${data.type}"><table data-id="${id}">
				<tr><th><span class="type">${data.base}</span> <b>${id}</b></th></tr>
				<tr><td>${ data.value === undefined ?
					'<span class="symbol">?</span>' : data.value
				}</td></tr>
			</table></div>`;
		case "char":
			return `
			<div class="variable ${data.type}"><table data-id="${id}">
				<tr><th><span class="type">${data.base}</span> <b>${id}</b></th></tr>
				<tr><td><span class="symbol">'</span>${ data.value === undefined ?
					'<span class="symbol">?</span>' : escaped(String.fromCharCode(data.value))
				}<span class="symbol">'</span></td></tr>
				<tr><td>${ data.value || "" }</td></tr>
			</table></div>`;
		case "string":
			return `
			<div class="variable ${data.type}"><table data-id="${id}">
				<tr><th><span class="type">${data.base}</span> <b>${id}</b></th></tr>
				<tr><td><span class="symbol">'</span>${ data.value === undefined ?
					'<span class="symbol">?</span>' : escaped(data.value)
				}<span class="symbol">'</span></td></tr>
			</table></div>`;
	}
	return "";
}

Environment.on_open = env => {
	if (env.merged) { // not a box of its own: it shares the box of its parent (the loop)
		const parent = scopeNodes.get(env.parent.uid);
		if (parent) { scopeNodes.set(env.uid, parent); mergedItems.set(env.uid, []); return; }
	}
	const node = { label: env.label, items: [], parent: itemsOf(env.parent), keys: [] };
	node.parent.push(node);
	scopeNodes.set(env.uid, node);
	scheduleRender();
};

Environment.on_close = env => {
	const node = scopeNodes.get(env.uid);
	if (!node) return;
	if (mergedItems.has(env.uid)) { // take back what the body put in the loop's box
		for (const { item, key } of mergedItems.get(env.uid)) {
			const i = node.items.lastIndexOf(item);
			if (i >= 0) node.items.splice(i, 1);
			variableItems.delete(key);
		}
		mergedItems.delete(env.uid);
		scopeNodes.delete(env.uid);
		scheduleRender();
		return;
	}
	node.parent.splice(node.parent.lastIndexOf(node), 1); // (it is almost always the last)
	for (const key of node.keys) variableItems.delete(key);
	scopeNodes.delete(env.uid);
	scheduleRender();
};

Environment.on_define = (env, id, data) => {
	if (data.isConst && data.dimensions === 0) return; // don't show constants in debug view
	const item = { id, data }, key = `${env.uid}/${id}`;
	itemsOf(env).push(item);
	variableItems.set(key, item);
	if (mergedItems.has(env.uid)) mergedItems.get(env.uid).push({ item, key });
	else scopeNodes.get(env.uid)?.keys.push(key);
	scheduleRender();
};

Environment.on_change = (env, id, data) => {
	const item = variableItems.get(`${env.uid}/${id}`);
	if (!item) return;
	item.data = data;
	scheduleRender();
};

function madeWithLove() {
	vanillaToast.show(Language.main.loveMessage, { duration: 3000, fadeDuration: 500 });
}

function escaped(s) {
	return s.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/\n/g, "\\n")
		.replace(/\r/g, "\\r")
		.replace(/\t/g, "\\t");
}

function save() {
	let name = prompt(Language.main.saveFile, Language.main.saveName);
	if (!name.endsWith(".cpp")) name += ".cpp";
	const code = editor.getValue();
	const blob = new Blob([code], { type: "text/plain" });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = name;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	URL.revokeObjectURL(url);
}
