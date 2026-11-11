const test = require("node:test");
const assert = require("node:assert/strict");

const { createDockController } = require("../../app/renderer/src/ui/dock-controller");

function createLayout() {
  return {
    mount() {},
    update() {},
    setVisible() {},
    destroy() {},
  };
}

test("dock controller forwards Modern selections to the application callback", () => {
  const modern = createLayout();
  let selection = null;
  createDockController({
    layouts: { classic: createLayout(), modern },
    onModernSelect(id, metadata) {
      selection = { id, metadata };
    },
  });

  modern.onSelect("appearance", { focus: true });

  assert.deepEqual(selection, {
    id: "appearance",
    metadata: { focus: true },
  });
});
