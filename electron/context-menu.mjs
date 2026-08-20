/**
 * Native Edit context menu for inputs and selected text.
 * Electron does not show cut/copy/paste on right-click unless we attach this.
 */
import { clipboard, Menu, shell } from "electron";

/**
 * @param {import('electron').BrowserWindow} win
 */
export function attachContextMenu(win) {
  win.webContents.on("context-menu", (_event, params) => {
    if (win.isDestroyed()) return;

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
        template.push({ label: "No Spelling Suggestions", enabled: false });
      }
      template.push({
        label: "Add to Dictionary",
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
        { role: "undo", enabled: Boolean(flags.canUndo) },
        { role: "redo", enabled: Boolean(flags.canRedo) },
        { type: "separator" },
        { role: "cut", enabled: Boolean(flags.canCut) },
        { role: "copy", enabled: Boolean(flags.canCopy) },
        { role: "paste", enabled: Boolean(flags.canPaste) },
        { role: "delete", enabled: Boolean(flags.canDelete) },
        { type: "separator" },
        { role: "selectAll", enabled: flags.canSelectAll !== false },
      );
    } else if (hasSelection) {
      template.push({ role: "copy" });
      template.push({
        label: "Copy as Markdown",
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
          label: "Open Link",
          click: () => {
            void shell.openExternal(href);
          },
        },
        {
          label: "Copy Link",
          click: () => clipboard.writeText(href),
        },
      );
    }

    if (!template.length) return;
    Menu.buildFromTemplate(template).popup({ window: win });
  });
}
