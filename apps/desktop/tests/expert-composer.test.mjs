import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

let server, ExpertComposer, ExpertConversationActions;
before(async () => {
  server = await createServer({ configFile: false, root: fileURLToPath(new URL("..", import.meta.url)),
    appType: "custom", server: { middlewareMode: true, hmr: false, ws: false },
    esbuild: { jsx: "automatic" }, optimizeDeps: { noDiscovery: true, include: [] } });
  ({ ExpertComposer, ExpertConversationActions } = await server.ssrLoadModule("/src/components/expert/ExpertComposer.tsx"));
});
after(async () => { await server?.close(); });

function descendants(tree) {
  if (Array.isArray(tree)) return tree.flatMap(descendants);
  return tree?.props ? [tree, ...descendants(tree.props.children)] : [];
}
function fixture(overrides = {}) {
  const sent = [], actions = [];
  const nodes = descendants(ExpertComposer({ message: "  Synthetic question  ", maxLength: 4000,
    conversationActive: true, ready: true, busy: false, starting: false,
    onSend: value => sent.push(value), onMessageChange: () => {}, onStop: () => actions.push("stop"), ...overrides }));
  const form = nodes.find(node => node.type === "form"), textarea = nodes.find(node => node.type === "textarea");
  function enter(options = {}) {
    let prevented = false, submitted = false;
    textarea.props.onKeyDown({ key: "Enter", shiftKey: false, repeat: false, nativeEvent: {},
      preventDefault: () => { prevented = true; },
      currentTarget: { form: { requestSubmit: () => { submitted = true; form.props.onSubmit({ preventDefault() {} }); } } }, ...options });
    return { prevented, submitted };
  }
  return { nodes, form, sent, actions, enter };
}

test("Enter sends through the same form handler as the Send button", () => {
  const { enter, sent, form } = fixture();
  assert.deepEqual(enter(), { prevented: true, submitted: true });
  assert.deepEqual(sent, ["Synthetic question"]);
  form.props.onSubmit({ preventDefault() {} });
  assert.deepEqual(sent, ["Synthetic question", "Synthetic question"]);
});

test("Shift+Enter and IME composition retain normal text entry without sending", () => {
  const { enter, sent } = fixture();
  for (const event of [{ shiftKey: true }, { nativeEvent: { isComposing: true } }, { nativeEvent: { keyCode: 229 } }, { key: "a" }]) {
    assert.deepEqual(enter(event), { prevented: false, submitted: false });
  }
  assert.deepEqual(sent, []);
});

test("Blank, busy, starting and unavailable composers never send; holding Enter does not repeat sends", () => {
  for (const overrides of [{ message: "  " }, { busy: true }, { starting: true }, { ready: false }]) {
    const { enter, sent, form } = fixture(overrides);
    assert.equal(enter().submitted, false);
    form.props.onSubmit({ preventDefault() {} });
    assert.deepEqual(sent, []);
  }
  const { enter, sent } = fixture();
  assert.equal(enter({ repeat: true }).submitted, false);
  assert.deepEqual(sent, []);
});

test("Stop stays in the composer; conversation actions keep their callbacks in the top section", () => {
  const { nodes, sent, actions } = fixture({ busy: true });
  const topActions = descendants(ExpertConversationActions({ busy: true, starting: false, conversationActive: true,
    onNewConversation: () => actions.push("new"), onClearConversation: () => actions.push("clear"),
    onClearHistory: () => actions.push("history") }));
  const stop = nodes.find(node => node.type === "button" && node.props.children === "Stop");
  assert.equal(stop.props.type, "button");
  stop.props.onClick();
  for (const label of ["Clear Conversation", "Clear All AI History"]) {
    assert.equal(nodes.some(node => node.type === "button" && node.props.children === label), false);
    const button = topActions.find(node => node.type === "button" && node.props.children === label);
    assert.equal(button.props.type, "button");
    button.props.onClick();
  }
  assert.deepEqual(actions, ["stop", "clear", "history"]);
  assert.deepEqual(sent, []);
  assert.equal(topActions.find(node => node.type === "button" && node.props.children === "New Conversation").props.disabled, true);
});
