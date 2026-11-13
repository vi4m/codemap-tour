export function highlight(line: string) {
  return line
    .split(
      /(\/\/.*$|#.*$|"[^"\n]*"|'[^'\n]*'|\b(?:import|from|export|class|struct|func|function|const|let|var|async|await|return|if|else|guard|throw|throws|try|public|private|def|for|in|new|true|false|null|nil)\b)/g,
    )
    .map((part, i) => (
      <span
        key={i}
        className={
          /^(\/\/|#)/.test(part)
            ? "tok-comment"
            : /^['"]/.test(part)
              ? "tok-string"
              : /^(import|from|export|class|struct|func|function|const|let|var|async|await|return|if|else|guard|throw|throws|try|public|private|def|for|in|new|true|false|null|nil)$/.test(
                    part,
                  )
                ? "tok-keyword"
                : undefined
        }
      >
        {part}
      </span>
    ));
}
