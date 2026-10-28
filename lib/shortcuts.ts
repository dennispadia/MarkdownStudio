export const formattingShortcuts = [
  { command: 'bold', label: 'Bold', code: 'KeyB', shift: false, accelerator: 'CmdOrCtrl+B' },
  { command: 'italic', label: 'Italic', code: 'KeyI', shift: false, accelerator: 'CmdOrCtrl+I' },
  { command: 'strike', label: 'Strikethrough', code: 'KeyX', shift: true, accelerator: 'CmdOrCtrl+Shift+X' },
  { command: 'code', label: 'Inline code', code: 'KeyE', shift: false, accelerator: 'CmdOrCtrl+E' },
  { command: 'bullet', label: 'Bullet list', code: 'Digit8', shift: true, accelerator: 'CmdOrCtrl+Shift+8' },
  { command: 'ordered', label: 'Numbered list', code: 'Digit7', shift: true, accelerator: 'CmdOrCtrl+Shift+7' },
  { command: 'task', label: 'Task list', code: 'Digit9', shift: true, accelerator: 'CmdOrCtrl+Shift+9' },
  { command: 'quote', label: 'Block quote', code: 'KeyQ', shift: true, accelerator: 'CmdOrCtrl+Shift+Q' },
] as const;
