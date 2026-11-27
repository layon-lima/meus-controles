"""Preflight estrutural de CSS: detecta delimitadores que invalidam o restante da folha."""
from pathlib import Path
import re
import sys

TOKEN = re.compile(r"""(?P<comment>/\*[\s\S]*?\*/)|(?P<string>"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*')|(?P<escape>\\[\s\S])|(?P<broken_comment>/\*)|(?P<delimiter>[(){}\[\]"'])""")
PAIRS = {")": "(", "}": "{", "]": "["}


def validate_css(source, name="CSS"):
    stack = []
    for match in TOKEN.finditer(source):
        token = match.group()
        if match.lastgroup == "broken_comment" or (match.lastgroup == "delimiter" and token in ('"', "'")):
            raise ValueError(f"{name}:{source.count(chr(10), 0, match.start())+1}: comentário ou string sem fechamento")
        if match.lastgroup != "delimiter":
            continue
        if token in "({[":
            stack.append((token, match.start()))
        elif not stack or stack[-1][0] != PAIRS[token]:
            raise ValueError(f"{name}:{source.count(chr(10), 0, match.start())+1}: delimitador inesperado {token}")
        else:
            stack.pop()
    if stack:
        token, position = stack[-1]
        raise ValueError(f"{name}:{source.count(chr(10), 0, position)+1}: delimitador não fechado {token}")


def validate_directory(directory):
    files = sorted(Path(directory).glob("*.css"))
    if not files:
        raise ValueError("Nenhuma folha CSS encontrada")
    for path in files:
        validate_css(path.read_text(encoding="utf-8"), path.name)
    return len(files)


if __name__ == "__main__":
    try:
        print(f"OK: {validate_directory(sys.argv[1])} folhas CSS com delimitadores válidos.")
    except (ValueError, OSError) as error:
        sys.exit(str(error))
