/**
 * Native Edit context menu for inputs and selected text.
 * Electron does not show cut/copy/paste on right-click unless we attach this.
 */
import { app, clipboard, Menu, shell } from "electron";
import {
  normalizeLocalePref,
  resolveLocale,
  translate,
} from "../shared/ui-copy.mjs";

/**
 * @param {import('electron').BrowserWindow} win
 * @param {() => unknown} [getLocalePref]  returns stored localePref from app state
 */
export function attachContextMenu(win, getLocalePref) {
  win.webContents.on("context-menu", (_event, params) => {
    if (win.isDestroyed()) return;

    let system = "en";
    try {
      system = app.getLocale();
    } catch {
      /* app not ready */
    }
    const locale = resolveLocale(
      normalizeLocalePref(getLocalePref?.()),
      system,
    );
    const L = (key) => translate(locale, key);

    /** @type {import('electron').MenuItemConstructorOptions[]} */
    const template = [];
    const flags = params.editFlags || {};
    const hasSelection = Boolean(params.selectionText?.trim());

    if (params.misspelledWord) {
      const suggestions = params.dictionarySuggestions || [];
      for (const word of suggestions.slice(0, 6)) {
        template.push({
          label: word,
          click: () => win.webContents.replaceMisspelling(word),
        });
      }
      if (suggestions.length === 0) {
        template.push({ label: L("menu.noSpelling"), enabled: false });
      }
      template.push({
        label: L("menu.addToDictionary"),
        click: () => {
          win.webContents.session.addWordToSpellCheckerDictionary(
            params.misspelledWord,
          );
        },
      });
      template.push({ type: "separator" });
    }

    if (params.isEditable) {
      template.push(
        { role: "undo", label: L("menu.undo"), enabled: Boolean(flags.canUndo) },
        { role: "redo", label: L("menu.redo"), enabled: Boolean(flags.canRedo) },
        { type: "separator" },
        { role: "cut", label: L("menu.cut"), enabled: Boolean(flags.canCut) },
        { role: "copy", label: L("menu.copy"), enabled: Boolean(flags.canCopy) },
        {
          role: "paste",
          label: L("menu.paste"),
          enabled: Boolean(flags.canPaste),
        },
        {
          role: "delete",
          label: L("menu.delete"),
          enabled: Boolean(flags.canDelete),
        },
        { type: "separator" },
        {
          role: "selectAll",
          label: L("menu.selectAll"),
          enabled: flags.canSelectAll !== false,
        },
      );
    } else if (hasSelection) {
      template.push({ role: "copy", label: L("menu.copy") });
      template.push({
        label: L("menu.copyAsMarkdown"),
        click: () => {
          void win.webContents.executeJavaScript(
            "window.__grokCopySelectionMarkdown && window.__grokCopySelectionMarkdown()",
          );
        },
      });
    }

    if (params.linkURL && /^https?:\/\//i.test(params.linkURL)) {
      if (template.length) template.push({ type: "separator" });
      const href = params.linkURL;
      template.push(
        {
          label: L("menu.openLink"),
          click: () => {
            void shell.openExternal(href);
          },
        },
        {
          label: L("menu.copyLink"),
          click: () => clipboard.writeText(href),
        },
      );
    }

    if (!template.length) return;
    Menu.buildFromTemplate(template).popup({ window: win });
  });
}
