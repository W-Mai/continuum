#!/usr/bin/env python3
"""Run a gh api call with retries.

The network path to api.github.com drops TLS handshakes intermittently, so a
single call fails often enough that wrapping every one by hand is unreliable.
Prints the response body on success and exits non-zero otherwise.
"""

import subprocess
import sys
import time

RETRIES = 8


def main(argv):
    if not argv:
        print("usage: ghretry.py <gh api args...>", file=sys.stderr)
        return 2
    last = ""
    for attempt in range(RETRIES):
        r = subprocess.run(["gh", "api", *argv], capture_output=True, text=True)
        if r.returncode == 0:
            sys.stdout.write(r.stdout)
            return 0
        last = (r.stderr or r.stdout).strip()
        transient = any(
            s in last
            for s in ("TLS handshake", "EOF", "SSL_ERROR", "timeout", "connection reset", "502", "503")
        )
        if not transient:
            print(last, file=sys.stderr)
            return r.returncode
        time.sleep(2 + attempt)
    print(last, file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
