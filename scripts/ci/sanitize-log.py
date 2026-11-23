#!/usr/bin/env python3
"""Write a sanitized copy of a CI step log for public artifact upload.

Collapses absolute paths to [path] and ALLCAP env assignments to [env] while
keeping public diagnostic text. Output is capped at the tail of the source.
"""
import pathlib
import re
import sys


def sanitize(text):
    text = re.sub(r'(?:/[A-Za-z0-9_.+@%^(),= \-]+){2,}', '[path]', text)
    text = re.sub(r'\b[A-Z][A-Z0-9_]{2,}=[^ \n]+', '[env]', text)
    return text


def main():
    if len(sys.argv) != 3:
        print('usage: sanitize-log.py <in> <out>', file=sys.stderr)
        return 2
    src, dst = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
    if not src.is_file() or src.is_symlink():
        return 1
    text = src.read_text(encoding='utf-8', errors='replace')
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_text(sanitize(text)[-2_000_000:], encoding='utf-8')
    return 0


if __name__ == '__main__':
    sys.exit(main())
