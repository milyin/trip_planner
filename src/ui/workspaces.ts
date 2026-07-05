import { buildShareUrl } from '../state/share';
import { emitChange, reloadActiveWorkspace } from '../state/store';
import {
  activeWorkspace, createWorkspace, deleteWorkspace, listWorkspaces, renameWorkspace, setActiveWorkspace,
} from '../state/workspaces';
import { byId, mkBtn } from './dom';

/** Reflect the active workspace's name in the brand line. */
export function refreshWorkspaceUi(): void {
  byId('brandWs').textContent = activeWorkspace().name;
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
    const name = document.createElement('span');
    name.className = 'pname';
    name.textContent = ws.name + (ws.id === current ? ' (current)' : '');
    const open = mkBtn(ws.id === current ? '✓' : 'Open', 'btn sm' + (ws.id === current ? ' ghost' : ' primary'));
    open.disabled = ws.id === current;
    open.onclick = () => {
      byId('wsOverlay').classList.remove('open');
      switchTo(ws.id);
    };
    row.append(name, open);
    box.appendChild(row);
  }
}

/** Wire the ☰ workspace items and the select dialog (once, at startup). */
export function wireWorkspaces(): void {
  refreshWorkspaceUi();
  byId('wsNewBtn').addEventListener('click', () => {
    const name = prompt('Name for the new workspace:', 'New trip');
    if (name === null) return;
    const ws = createWorkspace(name);
    switchTo(ws.id);
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
