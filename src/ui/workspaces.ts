import { buildShareUrl } from '../state/share';
import { emitChange, reloadActiveWorkspace, subscribe } from '../state/store';
import {
  activeWorkspace, copyWorkspace, createWorkspace, deleteWorkspace, listWorkspaces, renameWorkspace,
  setActiveWorkspace, workspaceCities,
} from '../state/workspaces';
import { byId, mkBtn } from './dom';

/** Reflect the active workspace in the brand: its name as the title and the
 * cities it visits as the subtitle. */
export function refreshWorkspaceUi(): void {
  const ws = activeWorkspace();
  byId('brandWs').textContent = ws.name;
  const cities = workspaceCities(ws.id);
  byId('brandCities').textContent = cities.length ? cities.join(' · ') : 'no segments yet';
}

function switchTo(id: string): void {
  setActiveWorkspace(id);
  reloadActiveWorkspace();
  refreshWorkspaceUi();
  emitChange();
}

function renderWsList(): void {
  const box = byId('wsList');
  box.innerHTML = '';
  const current = activeWorkspace().id;
  for (const ws of listWorkspaces()) {
    const row = document.createElement('div');
    row.className = 'parser-row ws-row' + (ws.id === current ? ' current' : '');
    const label = document.createElement('span');
    label.className = 'pname';
    const name = document.createElement('span');
    name.className = 'ws-name';
    name.textContent = ws.name + (ws.id === current ? ' (current)' : '');
    const cities = document.createElement('small');
    cities.className = 'ws-cities';
    const list = workspaceCities(ws.id);
    cities.textContent = list.length ? list.join(' · ') : 'no segments yet';
    label.append(name, cities);
    const open = mkBtn(ws.id === current ? '✓' : 'Open', 'btn sm' + (ws.id === current ? ' ghost' : ' primary'));
    open.disabled = ws.id === current;
    open.onclick = () => {
      byId('wsOverlay').classList.remove('open');
      switchTo(ws.id);
    };
    row.append(label, open);
    box.appendChild(row);
  }
}

/** Wire the ☰ workspace items and the select dialog (once, at startup). */
export function wireWorkspaces(): void {
  refreshWorkspaceUi();
  // the cities subtitle follows the items
  subscribe(refreshWorkspaceUi);
  byId('wsNewBtn').addEventListener('click', () => {
    const ws = createWorkspace('New workspace');
    switchTo(ws.id);
  });
  byId('wsCopyBtn').addEventListener('click', () => {
    const src = activeWorkspace();
    const name = prompt('Name for the copy of this workspace:', `${src.name} (copy)`);
    if (name === null || !name.trim()) return;
    void copyWorkspace(src.id, name).then((ws) => switchTo(ws.id));
  });
  byId('wsSelectBtn').addEventListener('click', () => {
    renderWsList();
    byId('wsOverlay').classList.add('open');
  });
  byId('wsRenameBtn').addEventListener('click', () => {
    const ws = activeWorkspace();
    const name = prompt('Rename workspace:', ws.name);
    if (name === null || !name.trim()) return;
    renameWorkspace(ws.id, name);
    refreshWorkspaceUi();
  });
  byId('wsShareBtn').addEventListener('click', () => {
    void (async () => {
      const url = await buildShareUrl();
      try {
        await navigator.clipboard.writeText(url);
        alert(
          'Share link copied to the clipboard.\n' +
            'It contains all segments and locations of this workspace (images and LLM logs stay on this device).',
        );
      } catch {
        prompt('Copy the share link:', url);
      }
    })();
  });
  byId('wsDeleteBtn').addEventListener('click', () => {
    const ws = activeWorkspace();
    if (!confirm(`Delete workspace "${ws.name}" with all its segments (including stored images)?`)) return;
    deleteWorkspace(ws.id);
    reloadActiveWorkspace();
    refreshWorkspaceUi();
    emitChange();
  });
  byId('closeWs').onclick = () => byId('wsOverlay').classList.remove('open');
  byId('wsCancelBtn').onclick = () => byId('wsOverlay').classList.remove('open');
}
