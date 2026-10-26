import { test } from "node:test";
import assert from "node:assert/strict";
import { catalogs, translate } from "../shared/ui-copy.mjs";
import {
  DESKTOP_COMMANDS,
  filterCommands,
  commandDescription,
} from "../src/lib/commands.ts";

test("desktop command descriptions come from the en catalog", () => {
  assert.ok(DESKTOP_COMMANDS.length > 0);
  for (const cmd of DESKTOP_COMMANDS) {
    assert.equal(cmd.source, "desktop");
    const key = cmd.descriptionKey;
    assert.equal(typeof key, "string");
    assert.ok(key in catalogs.en);
    assert.ok(key in catalogs["zh-CN"]);
    assert.notEqual(cmd.description, key);
    assert.equal(cmd.description, catalogs.en[key]);
    assert.equal(cmd.description, translate("en", key));
    assert.equal(
      commandDescription(cmd, (k) => translate("zh-CN", k)),
      catalogs["zh-CN"][key],
    );
  }
});

test("filterCommands searches the catalog English description", () => {
  const hit = filterCommands(DESKTOP_COMMANDS, "detachable");
  assert.ok(hit.some((cmd) => cmd.name === "preview"));
});
