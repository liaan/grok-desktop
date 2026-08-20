import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  menuListsOpenWindows,
  windowCycleKind,
  windowListMenuItems,
} from "../electron/window-menu.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("window menu layout", () => {
  it("Windows lists open windows and does not cycle with Ctrl+Tab", () => {
    assert.equal(windowCycleKind("win32"), "none");
    assert.equal(menuListsOpenWindows("win32"), true);
  });

  it("macOS keeps Cmd+` cycling and uses the OS window list", () => {
    assert.equal(windowCycleKind("darwin"), "cmd-backtick");
    assert.equal(menuListsOpenWindows("darwin"), false);
  });

  it("Linux keeps Ctrl+Tab cycling and lists open windows", () => {
    assert.equal(windowCycleKind("linux"), "ctrl-tab");
    assert.equal(menuListsOpenWindows("linux"), true);
  });

  it("window list radios mark the focused shell", () => {
    const items = windowListMenuItems(
      [
        { id: 1, title: "foo · Grok", focused: false },
        { id: 2, title: "bar · Grok", focused: true },
      ],
      () => {},
    );
    assert.equal(items.length, 2);
    assert.equal(items[0].type, "radio");
    assert.equal(items[0].checked, false);
    assert.equal(items[1].checked, true);
    assert.equal(items[0].label, "foo · Grok");
    assert.equal(items[1].label, "bar · Grok");
  });

  it("disambiguates duplicate titles", () => {
    const items = windowListMenuItems(
      [
        { id: 3, title: "Grok Desktop", focused: true },
        { id: 8, title: "Grok Desktop", focused: false },
      ],
      () => {},
    );
    assert.equal(items[0].label, "Grok Desktop · 3");
    assert.equal(items[1].label, "Grok Desktop · 8");
  });

  it("main wires the helpers instead of a shared Win/Linux cycle menu", () => {
    const main = readFileSync(path.join(root, "electron/main.mjs"), "utf8");
    assert.match(main, /from "\.\/window-menu\.mjs"/);
    assert.match(main, /windowListMenuItems/);
    assert.match(main, /windowCycleKind/);
    assert.match(main, /menuListsOpenWindows/);
  });
});
