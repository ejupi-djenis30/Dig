const UNSAFE_TERMINAL_CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/gu;

/** Make untrusted server text inert before writing it to an interactive terminal. */
export function safeTerminalText(value) {
  return String(value)
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\\r")
    .replace(UNSAFE_TERMINAL_CONTROLS, (character) => {
      const code = character.codePointAt(0).toString(16).padStart(2, "0");
      return `\\x${code}`;
    });
}
