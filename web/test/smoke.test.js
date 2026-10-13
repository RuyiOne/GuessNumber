const test = require("node:test");
const assert = require("node:assert/strict");

test("web package is wired", () => {
  assert.equal(1 + 1, 2);
});
