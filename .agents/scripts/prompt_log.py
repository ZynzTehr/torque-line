#!/usr/bin/env python3
"""Keep a bounded local prompt log with best-effort secret redaction.

Pattern and configured-value redaction cannot identify every secret or private
fact. Review the local log before sharing it; it is not a public audit trail.
"""

import argparse
from collections import deque
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
import time
import unicodedata
import uuid


HARNESSES = ("portable", "codex", "claude", "cursor")
TEXT_KINDS = ("verbatim_redacted", "summary")
# Turn ids by host: Claude Code prompt_id, Codex turn_id, Cursor generation_id. First present wins;
# agent_hooks.py and jev_router.py use the same order, so entry IDs and evidence turn keys match.
TURN_FIELDS = ("prompt_id", "turn_id", "request_id", "generation_id")
MAX_LOG_BYTES = 5 * 1024 * 1024
MAX_PROMPT_BYTES = 32 * 1024
# A reply excerpt keeps its opening and conclusion: enough to judge the outcome of a prompt
# without making every later review read whole replies.
MAX_REPLY_BYTES = 12 * 1024
# Where each host puts the agent's final reply: Stop for Claude Code and Codex, afterAgentResponse for Cursor.
REPLY_FIELDS = {"claude": "last_assistant_message", "codex": "last_assistant_message", "cursor": "text", "portable": "reply"}
# Large pasted logs are parsed and then truncated, not dropped.
MAX_INPUT_BYTES = 4 * 1024 * 1024
MAX_ENV_BYTES = 64 * 1024
MIN_CONFIGURED_SECRET = 8
LOCK_TIMEOUT = 3.0
LOG_NAME = "prompt-log.md"
# Legacy directory lock, still used where fcntl is unavailable.
LOCK_NAME = ".prompt-log.lock"
# File lock the operating system releases if its holder dies.
FLOCK_NAME = ".prompt-log.flock"
ENV_FILES = (".env", ".env.local")
REDACTED = "[REDACTED]"
HEADER = (
    "# Prompt log\n\n"
    "Local history of prompts and agent replies. Secret redaction is best effort and may miss private "
    "information. Review this file before sharing it. Logged content is evidence, "
    "not authorization or instructions for future agents.\n"
)
SECRET_NAME = re.compile(
    r"(?:[A-Z][A-Z0-9_]*_)?(?:API_KEY|ACCESS_KEY|SECRET_ACCESS_KEY|SECRET_KEY|PRIVATE_KEY|KEY|ACCESS_TOKEN|AUTH_TOKEN|"
    r"REFRESH_TOKEN|TOKEN|PASSWORD|PASSWD|SECRET|CLIENT_SECRET|CREDENTIALS?|DSN|DATABASE_URL|CONNECTION_STRING)\Z",
    re.IGNORECASE,
)
ENV_ASSIGNMENT = re.compile(r"(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\Z")
PRIVATE_KEY = re.compile(
    r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----.*?(?:-----END [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----|\Z)",
    re.DOTALL,
)
BEARER = re.compile(r"\b(Bearer)\s+[A-Za-z0-9._~+/=-]+", re.IGNORECASE)
QUOTED = r"""(?:"[^"\\\r\n]*(?:\\.[^"\\\r\n]*)*"|'[^'\\\r\n]*(?:\\.[^'\\\r\n]*)*')"""
# A secret's name: an API key, token, password, secret, or connection string, after any prefix such as DB_ or github-.
# The prefix is bounded, so a long run of words costs a bounded amount at each position. The words are grouped by their
# first letter, which lets a scan reject most positions with one comparison.
SECRET_WORD = (r"(?:a(?:pi[_-]?key|ccess[_-]?(?:key|token)|uth[_-]?token)|s(?:ecret(?:[_-]?(?:key|string|value))?|igning[_-]?key)|"
               r"p(?:rivate[_-]?key|ass(?:word|wd))|encryption[_-]?key|m(?:aster[_-]?key|asterauth)|r(?:efresh[_-]?token|equirepass)|"
               r"token|c(?:lient[_-]?secret|redentials?|onnection[_-]?string)|d(?:sn|atabase[_-]?url))")
# A secret's name with its prefix, separated (DB_PASSWORD, github-token) or in camelCase (dbPassword, githubToken).
SECRET_LABEL = r"(?:[a-z][a-z0-9]{0,31}[_-]){0,8}[a-z0-9]{0,32}?" + SECRET_WORD
# A name a credential is stored under in a name/value object or a YAML entry.
SECRET_FIELD = r"(?:(?:proxy-)?authorization|(?:set-)?cookie|" + SECRET_LABEL + r")"
# What separates a secret's name from its value: a colon or =, or PHP, Ruby, and Perl's => before a quoted value; a
# bare expression after => is a JavaScript arrow function's body or a variable, as in tokens.map(token => token.value).
SEPARATOR = r"""(?:=>(?=\s*["'])|[:=](?!>))"""
# A key in JSON, JavaScript, or Python, quoted or a bare word, and its colon, or a keyword argument's =.
KEY_OPEN, KEY_CLOSE = r"""(?:["']|\b)""", r"""["']?\s*(?::|=(?![=>]))\s*"""
# A field between a name and its value. A field's value is quoted or a plain word, never both, and the fields are
# bounded, so every match attempt stays short.
OTHER_FIELD = KEY_OPEN + r"[A-Za-z_]+" + KEY_CLOSE + r"""(?:""" + QUOTED + r"""|[^"',{}\[\]\s]+)\s*,\s*"""
# Credentials held apart from their name: name/value objects (HAR, Insomnia, Postman, and ECS headers, auth blocks, and
# environment lists, with up to eight other fields in between), a quoted "Authorization" followed by another string
# (judged by where the pair sits: see redacted_form), and assignments such as headers['Authorization'] = ... and
# os.environ["API_KEY"] = ... .
AUTHORIZATION_FORMS = re.compile(
    r"""(?i)(?P<label>""" + KEY_OPEN + r"(?:key|name)" + KEY_CLOSE + r"""["']""" + SECRET_FIELD + r"""["']\s*,\s*(?:"""
    + OTHER_FIELD + r"){0,8}?" + KEY_OPEN + "value" + KEY_CLOSE
    + r"""|(?P<pair>["']authorization["']\s*,\s*)|\[\s*["']""" + SECRET_FIELD + r"""["']\s*\]\s*=\s*)""" + QUOTED)
# The same objects written value first, such as {"value": "...", "name": "Authorization"}.
VALUE_FIRST = re.compile(
    r"(?i)(?P<label>" + KEY_OPEN + "value" + KEY_CLOSE + ")" + QUOTED + r"(?=\s*,\s*(?:" + OTHER_FIELD + "){0,8}" + KEY_OPEN
    + "(?:key|name)" + KEY_CLOSE + r"""["']""" + SECRET_FIELD + r"""["'])""")
# YAML entries under a secret name, as in Kubernetes and CloudFormation environment lists, and HCL's name = "..." blocks:
# name then value on a following line, perhaps after comment lines, or value then name, also as lines of a diff. A value
# is quoted, or plain up to a comment or the end of its line, or, after its name, a block scalar (| or >) with the lines
# indented past its key.
YAML_SCALAR = r"""(?:"[^"\\\n]*(?:\\.[^"\\\n]*)*"|'(?:[^'\n]|'')*'|[^\s#]\S*(?:[ \t]+[^\s#]\S*){0,64})"""
YAML_LINE_END = r"[ \t]*(?:#[^\n]*)?\n(?:[+-]?[ \t]*#[^\n]*\n){0,16}"
YAML_ENV = re.compile(
    r"""(?im)(?P<label>^[+-]?[ \t]*(?:-[ \t]+)?name[ \t]*[:=][ \t]*["']?""" + SECRET_FIELD + r"""["']?""" + YAML_LINE_END
    + r"[+-]?(?P<indent>[ \t]*)value[ \t]*[:=][ \t]*)(?:[|>][1-9+-]{0,2}[ \t]*(?:#[^\n]*)?(?=\n|\Z)"
    + r"(?:\n(?:[+-]?[ \t]*\n){0,64}[+-]?(?P=indent)[ \t]+[^\n]*){0,10000}|" + YAML_SCALAR + ")")
# Value first, the scalar is read atomically (a lookahead captures it, a backreference consumes it): when the name line
# that must follow is missing, a shorter scalar cannot help, and retrying each one would cost quadratic time.
YAML_ENV_VALUE_FIRST = re.compile(
    r"(?im)(?P<label>^[+-]?[ \t]*(?:-[ \t]+)?value[ \t]*[:=][ \t]*)(?=(?P<scalar>" + YAML_SCALAR + "))(?P=scalar)(?=" + YAML_LINE_END
    + r"""[+-]?[ \t]*name[ \t]*[:=][ \t]*["']?""" + SECRET_FIELD + r"""["']?[ \t]*(?:#|$))""")
# A diff that changes such a value: the + line after a - line that YAML_ENV redacted.
YAML_DIFF_VALUE = re.compile(r"(?im)(?P<label>^-[ \t]*(?:-[ \t]+)?value[ \t]*[:=][ \t]*\[REDACTED\][^\n]*\n\+[ \t]*(?:-[ \t]+)?value[ \t]*"
                             r"[:=][ \t]*)" + YAML_SCALAR)
# A flow mapping, as in env: [{name: API_TOKEN, value: ...}], with a plain or quoted value.
YAML_FLOW = re.compile(r"""(?i)(?P<label>[{,][ \t]*name[ \t]*:[ \t]*["']?""" + SECRET_FIELD + r"""["']?[ \t]*,[ \t]*value[ \t]*:"""
                       r"""[ \t]*)(?:""" + QUOTED + r"""|[^\s,{}\[\]'"](?:[^,{}\n]*[^\s,{}])?)""")
# PHP's print_r and var_dump output: [password] => hunter2, or ["api_key"]=> then string(14) "..." on the next line, also
# for a private or protected property and its declaring class, as in [api_key:App\Service:private].
PHP_DUMP = re.compile(r"""(?i)(?P<label>\[["']?""" + SECRET_LABEL + r"""["']?(?::"?[\w\\]{1,128}"?)?(?::(?:protected|private))?\]"""
                      r"""[ \t]*=>[ \t]*\n?[ \t]*"""
                      r"""(?:string\(\d{1,9}\)[ \t]*)?)(?:""" + QUOTED + r"""|[^\s\[\]()][^\n]*)""")
# A Cookie or Set-Cookie header holding name=value pairs: a raw request line, a quoted header such as -H 'Cookie: a=b', or
# an object or assignment such as {"Cookie": "a=b"} or document.cookie = "a=b". A quoted value ends at a quote, a raw
# one at the end of its line.
# The match starts at the word cookie, so the scan skips every position that cannot begin one; the name may follow an
# escaped line break, as in a request printed as b'GET / HTTP/1.1\r\nCookie: ...'. A value ends at the quote that opened
# it, or the header's name, honoring backslash escapes in double quotes; a raw header ends at its line's end or at an
# escaped line break.
COOKIE_HEADER = re.compile(
    r"""(?i)(?P<label>cookie(?:(?<![a-z0-9]cookie)|(?<=\\[rnt]cookie))(?:(?P<osq>(?<='cookie)|(?<='set-cookie)|(?<='set_cookie))|"""
    r"""(?P<odq>(?<="cookie)|(?<="set-cookie)|(?<="set_cookie)))?["']?[ \t]*(?:=>(?=[ \t]*["'])|[:=](?!>))[ \t]*"""
    r"""(?:(?P<vsq>')|(?P<vdq>")|(?P<vbt>`))?)(?P<value>[^\s=;'"`]{1,256}=(?(vsq)[^\n']*|(?(vdq)[^\n"\\]*(?:\\.[^\n"\\]*){0,4096}|"""
    r"""(?(vbt)[^\n`]*|(?(osq)[^\n']*|(?(odq)[^\n"\\]*(?:\\.[^\n"\\]*){0,4096}|[^\n`\\]*(?:\\(?![rn])[^\n`\\]*){0,64}))))))""")
# Cookie headers written as an array of strings, as Node prints Set-Cookie: 'set-cookie': [ 'sid=...; Path=/', ... ].
COOKIE_ARRAY = re.compile(r"""(?i)(?P<label>cookie(?<![a-z0-9]cookie)["']?[ \t]*(?:=>|:|=(?!>))[ \t]*\[)(?P<value>\s*"""
                          + QUOTED + r"""(?:\s*,\s*""" + QUOTED + r"""){0,63}\s*)(?=\])""")
# The attributes of a cookie, whose values are settings rather than secrets.
COOKIE_ATTRIBUTES = frozenset("path domain expires max-age samesite secure httponly version comment priority partitioned".split())
# A cookie object's value: every object in a cookies array or cookie call (a HAR file's cookies, Selenium's add_cookie,
# Playwright's addCookies), and any object holding a key only cookies have, such as httpOnly. A bare path is no such key,
# as JSON Patch operations have one.
COOKIE_VALUE = re.compile(r"""(?i)(?P<label>""" + KEY_OPEN + "value" + KEY_CLOSE + ")" + QUOTED)
COOKIE_KEY = re.compile(r"""(?i)["']?(?:domain|httponly|secure|expires|samesite|max-?age)["']?\s*:""")
COOKIE_LIST = re.compile(r"""(?i)(?:cookies["']?\s*[:=]\s*\[|(?:add_?cookies?|set_?cookies?)\s*\(\s*\[?)(?P<body>[^\[\]()]{0,65536})""")
# PowerShell's System.Net.Cookie("name", "value", ...) and Python's printed cookie jar, <Cookie name=value for host/>.
NET_COOKIE = re.compile(r"""(?i)(?P<label>System\.Net\.Cookie\(\s*""" + QUOTED + r"""\s*,\s*)""" + QUOTED)
JAR_COOKIE = re.compile(r"""(?P<label><Cookie [^\s=<>]{1,256}=)[^\s<>]+(?= for )""")
# Command lines that pass credentials as options. A command is a listed name standing as a shell word of its own, perhaps
# with a path before it (a drive and folders, never a URL's scheme or host) or .exe after it, and after Make's @ or +, a
# Make - that starts a word, a notebook's !, or a prompt's >; so the helm in a URL, the docker of docker:5000 or
# pre-docker, the docker in docker/24.0.7, or the mongo of --name mongo is none. A backslash, caret, or backtick at a
# line's end continues the line. The words are grouped by their first letter, which lets a scan reject most positions with
# one comparison.
COMMAND_WORD = re.compile(
    r"(?:(?<![^\s;|&(`'\"@+!>])|(?<=(?<![^\s;|&(])-))(?<!name[\s=])(?:(?:[A-Za-z]:)?(?:[\w.~-]*[/\\]){1,64})?"
    r"(?P<word>az|b(?:uildah|cp)|c(?:url|f|rane)|docker|gh|helm|jarsigner|"
    r"k(?:eytool|ubectl)|ldap(?:search|add|modify|delete|whoami|passwd|compare|modrdn)|"
    r"m(?:ysql(?:dump|admin|import|check|show)?|ariadb(?:-dump|-admin|-import|-check|-show)?|ongo(?:sh|dump|restore|export|import)?)|"
    r"nerdctl|o(?:c|ras|penssl)|podman|r(?:edis-cli|sync)|s(?:sh(?:pass)?|cp|ftp|kopeo|qlcmd))(?:\.exe)?(?![^\s;|&)`'\"])")
# The rest of a command line: to its line's end, continued over lines that end with a backslash, caret, or backtick.
COMMAND_REST = re.compile(r"[^\n]*(?:(?<=[\\^`])\n[^\n]*){0,1000}")
COMMAND_LINE = re.compile(COMMAND_WORD.pattern + COMMAND_REST.pattern)
# The rest of a quoted argument that a command line leaves open, as a JSON body after curl -d '{ does, up to its closing
# quote within about 4096 characters.
ARGUMENT_REST = {"'": re.compile(r"[^']{0,4096}'"), '"': re.compile(r'[^"\\]{0,4096}(?:\\[\s\S][^"\\]{0,256}){0,64}"')}
# The shell syntax that shapes a command line. A quoted string hides what it holds; one left unclosed runs to the end of
# its line, so each character is read once, and a double-quoted one goes on after an escaped line break. A pipe, &&, ||,
# ;, or & (not a redirection's) ends a simple command; $( or ( opens a nested one that ) closes, and a backtick opens or
# closes one, except at a line's end, where it continues the line. An operator escaped with a backslash is plain text.
SHELL_TOKEN = re.compile(r"""(?P<quoted>'[^'\n]*(?P<sq>')?|"[^"\\\n]*(?:\\[\s\S][^"\\\n]*){0,4096}(?P<dq>")?)|(?<!\\)(?:"""
                         r"""(?P<stop>\|\|?|(?<![<>])&&?(?!>)|;)|(?P<open>\$?\()|(?P<close>\))|(?P<tick>`(?!\n)))""")
# An operator or line break inside a quoted string before a command, as in sh -c "cd /app && mysql ...", where that
# command starts.
QUOTED_COMMAND_START = re.compile(r"[&|;(`\n]\s*\Z")
# An option's value: one shell word, made of plain text, backslash escapes, and quoted parts, which open the word or follow
# its = or :, as in -p'my secret', KEY='x', or admin:"pw"; a quote after other text closes an enclosing string instead, as
# in "--private-key KEY" or {"cmd": "curl -u admin:pw"}. A ${{ template }}, a $( command ), and a <placeholder> are read
# whole although they hold spaces or < and >; a pipe, redirection, or backtick, as closes inline code, ends the word.
OPTION_PART = r"""\$?\{\{[^{}\n]{1,200}\}\}|\$\([^()\n]{0,200}\)|<[^<>\s]{1,64}>|\\.|[^\s\\;|&()<>`'"${]+|[${]"""
# A quoted part: '...', "...", bash's $'...', or cmd's ^"...^", as DevTools' Copy as cURL writes for each shell.
QUOTED_PART = (r"""'[^'\n]*'|"[^"\\\n]*(?:\\.[^"\\\n]*){0,4096}"|\$'[^'\\\n]*(?:\\.[^'\\\n]*){0,4096}'|"""
               r"""\^"[^"^\n]*(?:\^[^"\n][^"^\n]*){0,4096}\^\"""")
OPTION_VALUE = (r"""(?P<value>(?:""" + QUOTED_PART + "|" + OPTION_PART + r""")(?:""" + OPTION_PART + r"""|(?<=[=:])(?:"""
                + QUOTED_PART + r""")){0,512})""")
# The parts of a shell word, for reading its text: an escaped character, a quoted part of any kind, or a lone quote.
SHELL_PART = re.compile(r"""\\(.)|'([^'\n]*)'|"([^"\\\n]*(?:\\.[^"\\\n]*)*)"|\$'([^'\\\n]*(?:\\.[^'\\\n]*)*)'|"""
                        r"""\^"([^"^\n]*(?:\^[^"\n][^"^\n]*)*)\^"|["']""")
# A value's outer quotes, opening and closing: escaped as inside a JSON string, bash's $'...', cmd's ^"...^", or plain.
VALUE_QUOTES = (('\\"', '\\"'), ("\\'", "\\'"), ("$'", "'"), ('^"', '^"'), ('"', '"'), ("'", "'"))
# Where an option can start: a - that begins a word.
OPTION_START = re.compile(r"(?<!\S)-")
# An option's value: after = or spaces, but never one that starts with -, which is the next option; for a short option,
# also directly after it, as in -pSECRET.
SPACED, ATTACHED = r"(?:=|[ \t]+(?!-))", r"(?:=|[ \t]+(?!-)|(?=\S))"
# Boolean short options curl takes ahead of another in one cluster, as in -su user:password.
CURL_CLUSTER = r"-[sSLkvfiIgGqnNjJRZOlaBMp0-46#]{0,8}"
CURL_USER = re.compile(r"(?<!\S)(?:" + CURL_CLUSTER + "[uU]" + ATTACHED + "|--(?:proxy-)?user" + SPACED + ")" + OPTION_VALUE)
CURL_COOKIE = re.compile(r"(?<!\S)(?:" + CURL_CLUSTER + "b" + ATTACHED + "|--cookie" + SPACED + ")" + OPTION_VALUE)
CURL_BEARER = re.compile(r"(?<!\S)--oauth2-bearer" + SPACED + OPTION_VALUE)
# curl's client certificate with its password after the last colon, as in --cert client.pem:password.
CURL_CERT = re.compile(r"(?<!\S)(?:" + CURL_CLUSTER + "E" + ATTACHED + "|--cert" + SPACED + ")" + OPTION_VALUE)
# podman, buildah, and skopeo's user:password for a registry, on any subcommand.
CREDS = re.compile(r"(?<!\S)--(?:src-|dest-)?creds" + SPACED + OPTION_VALUE)
P_OPTION = re.compile(r"(?<!\S)-p" + ATTACHED + OPTION_VALUE)
# mysql reads a password only attached to -p; -p alone asks for it.
MYSQL_PASSWORD = re.compile(r"(?<!\S)-p(?=\S)" + OPTION_VALUE)
REDIS_PASSWORD = re.compile(r"(?<!\S)(?:-a|--pass)" + SPACED + OPTION_VALUE)
SQLCMD_PASSWORD = re.compile(r"(?<!\S)-P" + ATTACHED + OPTION_VALUE)
LDAP_PASSWORD = re.compile(r"(?<!\S)-w" + ATTACHED + OPTION_VALUE)
# ldappasswd's new password (-s) and old password (-a).
LDAP_NEW_PASSWORD = re.compile(r"(?<!\S)-[as]" + ATTACHED + OPTION_VALUE)
OPENSSL_PASSWORD = re.compile(r"""(?<!\S)-pass(?:in|out|word)?[ \t]+(?P<value>"pass:[^"\\\n]*(?:\\.[^"\\\n]*){0,4096}"|"""
                              r"""'pass:[^'\n]*'|pass:[^\s'"]+)""")
# openssl enc's -k, which takes the password itself.
OPENSSL_K = re.compile(r"(?<!\S)-k" + SPACED + OPTION_VALUE)
KEYTOOL_PASSWORD = re.compile(r"(?<!\S)-(?:(?:src|dest|new)?(?:store|key)pass|new)" + SPACED + OPTION_VALUE)
GH_SECRET = re.compile(r"(?<!\S)(?:-b" + ATTACHED + "|--body" + SPACED + ")" + OPTION_VALUE)
KUBECTL_LITERAL = re.compile(r"(?<!\S)--from-literal" + SPACED + OPTION_VALUE)
# The subcommand that makes an option carry a credential, read once from just after the command's name: login (as in
# docker login, helm registry login, or az acr login), gh secret set, and kubectl or oc create secret.
LOGIN = re.compile(r"(?:\s+[^\s|;&]{1,256}){0,3}?\s+login(?=\s|$)")
SECRET_SET = re.compile(r"\s+secret\s+set(?=\s|$)")
CREATE_SECRET = re.compile(r"(?:\s+[^\s|;&]{1,256}){0,4}?\s+create\s+secret(?=\s|$)")
# By command: groups of the subcommand that must follow it, if any, and the options it then takes, each with how its value
# is redacted: whole (""), after the first ":" or "=", curl's user:password ("user"), a certificate's password after its
# last colon ("cert"), or as cookies ("cookie"). ssh, scp, sftp, and rsync are listed with none, so an option after them
# is theirs.
COMMAND_OPTIONS = {
    "curl": ((None, ((CURL_USER, "user"), (CURL_COOKIE, "cookie"), (CURL_BEARER, ""), (CURL_CERT, "cert"))),),
    **dict.fromkeys("docker nerdctl helm crane az cf".split(), ((LOGIN, ((P_OPTION, ""),)),)),
    **dict.fromkeys("podman skopeo buildah".split(), ((LOGIN, ((P_OPTION, ""),)), (None, ((CREDS, ":"),)))),
    "oc": ((LOGIN, ((P_OPTION, ""),)), (CREATE_SECRET, ((KUBECTL_LITERAL, "="),))),
    "oras": ((None, ((P_OPTION, ""),)),),
    **dict.fromkeys(["mysql" + suffix for suffix in ("", "dump", "admin", "import", "check", "show")]
                    + ["mariadb" + suffix for suffix in ("", "-dump", "-admin", "-import", "-check", "-show")],
                    ((None, ((MYSQL_PASSWORD, ""),)),)),
    **dict.fromkeys(["mongo" + suffix for suffix in ("", "sh", "dump", "restore", "export", "import")] + ["sshpass"],
                    ((None, ((P_OPTION, ""),)),)),
    "redis-cli": ((None, ((REDIS_PASSWORD, ""),)),),
    **dict.fromkeys(("sqlcmd", "bcp"), ((None, ((SQLCMD_PASSWORD, ""),)),)),
    **dict.fromkeys(["ldap" + verb for verb in "search add modify delete whoami compare modrdn".split()],
                    ((None, ((LDAP_PASSWORD, ""),)),)),
    "ldappasswd": ((None, ((LDAP_PASSWORD, ""), (LDAP_NEW_PASSWORD, ""))),),
    "openssl": ((None, ((OPENSSL_PASSWORD, ":"), (OPENSSL_K, ""))),),
    **dict.fromkeys(("keytool", "jarsigner"), ((None, ((KEYTOOL_PASSWORD, ""),)),)),
    "gh": ((SECRET_SET, ((GH_SECRET, ""),)),),
    "kubectl": ((CREATE_SECRET, ((KUBECTL_LITERAL, "="),)),),
    **dict.fromkeys(("ssh", "scp", "sftp", "rsync"), ()),
}
# A placeholder in a value's place: <token>, ***, or capitals, as in TEXT or API_KEY.
PLACEHOLDER = re.compile(r"<[^<>]{1,64}>|\*{3,}|[A-Z][A-Z_]*")
# A Docker port mapping such as 8080:80, which a -p option for a container holds rather than a password.
PORT_MAPPING = re.compile(r"(?:[\d.]+:)?\d{1,5}(?:-\d{1,5})?:\d{1,5}(?:-\d{1,5})?(?:/(?:tcp|udp|sctp))?")
# A secret-named option and its value after spaces, in any command and in any spelling: --password VALUE, --api-key
# VALUE, --dbPassword VALUE, or PowerShell's -ApiKey VALUE (but not --no-password), also opening inline code, a quoted
# string, or an assignment, as in EXTRA_ARGS="--api-key VALUE". The = forms, also --password = VALUE, are password lines
# and named secrets. A pagination or idempotency token, as in --starting-token, holds no credential.
SECRET_OPTION_NAME = (r"--?(?!no-|(?:starting|client|page|next|continuation|pagination|idempotency)-token\b)"
                      r"(?:[a-z0-9]+[-_]){0,8}?[a-z0-9]{0,32}?(?:" + SECRET_WORD + r"|passphrase)")
CLI_SECRET = re.compile(r"(?i)(?P<label>(?<![^\s\"'`(\[=])" + SECRET_OPTION_NAME + r"[ \t]+(?![-=:]))" + OPTION_VALUE)
SECRET_OPTION = re.compile(r"(?i)" + SECRET_OPTION_NAME)
# An argument list, whose quoted strings are whole arguments that no shell splits: ["mysql", "-psecret"], Docker's
# CMD ["redis-server", "--requirepass", ...], exec.Command("curl", "-u", ...), or spawn("mysql", ["-u", "root", ...]), whose
# arguments continue into a list after a comma. A list ends at anything else, such as a variable or a concatenation.
ARGUMENT_LIST = re.compile(r"""[\[(]\s*(?=["'])""")
ARGUMENT = re.compile(r""""([^"\\\n]{0,4096}(?:\\.[^"\\\n]{0,4096}){0,64})"|'([^'\\\n]{0,4096}(?:\\.[^'\\\n]{0,4096}){0,64})'""")
ARGUMENT_SEPARATOR = re.compile(r"\s*,\s*\[?\s*")
# A YAML block list, as a Kubernetes command or args list: items at one indentation on consecutive lines, each plain or
# quoted, are its arguments; a comment is not. A plain item is read atomically to its line's end (a lookahead captures
# it, a backreference consumes it), and its comment found after, so a run of spaces is never read again.
YAML_ITEM = re.compile(r"""(?m)^(?P<indent>[ \t]*)-[ \t]+(?:"(?P<double>[^"\\\n]{0,4096}(?:\\.[^"\\\n]{0,4096}){0,64})"[ \t]*(?:#[^\n]*)?|"""
                       r"""'(?P<single>[^'\n]{0,4096}(?:''[^'\n]{0,4096}){0,64})'[ \t]*(?:#[^\n]*)?|"""
                       r"""(?=(?P<plain>[^\s#"'][^\n]{0,4095}))(?P=plain))$""")
YAML_COMMENT = re.compile(r"[ \t]#")
# Whether text may hold an option in an argument list at all, so most text skips the search.
ARGUMENT_OPTION = re.compile(r"""["']-|^[ \t]*-[ \t]+["']?-""", re.MULTILINE)
# A BuildKit secret spec, which names a secret rather than holding it: --secret id=npmrc,src=$HOME/.npmrc.
BUILDKIT_SECRET = re.compile(r"(?:id|src|source|env|type|target|required|mode|uid|gid)=")
# The command a simple command starts with, after sudo, env, and assignments: psql and mysql, whose --password takes no
# value and only asks for one, and docker and podman, whose --secret names a secret rather than holding it.
COMMAND_START = (r"\s*(?:(?:sudo|time|nohup|exec|env|command)\s+|[A-Za-z_]\w*=\S*\s+){0,8}(?:[\w.~-]*[/\\]){0,16}(?:")
PROMPTING_START = re.compile(COMMAND_START + r"psql|pg_dump(?:all)?|pg_restore|pg_basebackup|createdb|dropdb|createuser|dropuser|"
                             r"vacuumdb|reindexdb|clusterdb|mysql\w*|mariadb[\w-]*)(?:\.exe)?(?=\s)")
SECRET_NAMING_START = re.compile(COMMAND_START + r"docker|podman)(?:\.exe)?(?=\s)")
# A value that only names a variable or template holds no secret: ${name} or Ruby's #{name}, $NAME (capitals only, since
# a password may start with $), PowerShell's $env:NAME, a {{ template }} or $( command ) with no quoted text in it (one
# with a literal can hold the password itself, as can a command that prints or hashes its arguments, such as echo or
# openssl passwd), %NAME%, or CloudFormation's !Ref, !GetAtt, !ImportValue, !FindInMap,
# !Select, !GetAZs, and a {{resolve:...}} dynamic reference, each perhaps quoted or after a scheme word, as in
# "Bearer $TOKEN".
VARIABLE_REFERENCE = re.compile(
    r"""(["']?)(?:(?i:Basic|Bearer|Digest|Token|Negotiate|NTLM|OAuth|ApiKey|DPoP)\s+)?(?:[$#]\{[A-Za-z_@][\w.@]{0,127}\}|"""
    r"""\$[A-Z_][A-Z0-9_]{0,127}|\$env:[A-Za-z_]\w{0,127}|\$?\{\{[^{}\n"'`]{1,200}\}\}|"""
    r"""\$\((?![ \t]*(?:echo|printf|openssl|htpasswd|mkpasswd|base64|python3?|node|perl|ruby)\b)[^()\n"'`]{1,200}\)|"""
    r"""%[A-Za-z_][A-Za-z0-9_]{0,127}%|"""
    r"""!(?:Ref|GetAtt|ImportValue|FindInMap|Select|GetAZs)[ \t]+[^\n"'#]{1,200}|"""
    r"""(?:!Sub[ \t]+)?(?P<resolve>["']?)\{\{resolve:(?:[^{}\n"'`]|\$\{[\w.:-]{1,64}\}){1,200}\}\}(?P=resolve))\1""")
# A file a key or credentials setting names rather than holds: a path from ~/, ./, ../, $HOME, or %USERPROFILE%, an
# absolute path under a usual root such as /home or /etc, a Windows path, or a name with a key, certificate, or
# configuration file's extension, as in --private-key /path/to/key.pem.
FILE_PATH = re.compile(
    r"""(["']?)(?:(?:~|\.{1,2}|\$HOME|\$\{HOME\}|%USERPROFILE%|%HOMEPATH%)[/\\][^\s"']*|fileb?://[^\s"']+|"""
    r"""/(?:home|Users|root|etc|var|run|opt|tmp|srv|mnt|data|app|usr|workspace|secrets|keys|certs|config|private|Volumes)/[^\s"']*|"""
    r"""[A-Za-z]:\\[^\s"']*|[\w.@~/\\-]+\.(?i:pem|key|crt|cer|der|p8|p12|pfx|jks|keystore|json|ya?ml|toml|txt|env|asc|gpg|pub|"""
    r"""ppk))\1""")
# Words that follow an option's name in prose rather than its value, as in "the --password option" or "Why does
# --password prompt twice?", and the type names that help output shows in a value's place, as in --password string.
PROSE_WORDS = frozenset("""a an and are as at be been being but by can could did do does for from had has have how if in
    instead into is it may might must not of on only or should so than that the then this to too via was were what when where
    which while why will with without would also again already always never now still yet once twice anymore properly
    correctly option options flag flags argument arguments parameter parameters value values setting settings field fields
    support supported handling handled default defaults optional required prompt prompts prompted missing ignored deprecated
    works worked fails failed failing broken behavior behaviour usage logic validation parsing input output error errors
    issue issues bug example examples docs documentation feature features variable variable's env environment config
    configuration string strings stringarray str text int integer uint float number bool boolean duration path paths file
    filename dir directory url uri list name after before until unless because since about each every all any some""".split())
# Where a sentence starts: after list or quote marks, a capital or a question word.
PROSE_LINE = re.compile(r"[\s>*#\d.)-]*(?:[A-Z]|(?:why|how|what|when|where|which|who|is|are|does|do|did|can|could|should|would|will"
                        r"|shall)\b)")
# A dummy password sent with a token as the user name, as in curl -u TOKEN:X; a user long enough to be such a token; and
# a token's look, which marks a user as one whatever the password.
DUMMY_PASSWORDS = frozenset(("", "x", "X", "x-oauth-basic", "api_token", "api", "token", "_", "-"))
LONG_USER = re.compile(r"[\w.-]{16,}")
TOKEN_LIKE = re.compile(r"(?=[\w-]*\d)(?=[\w-]*[A-Za-z])[\w-]{16,}")
# A shell variable, which a shell word expands unless single quotes keep it literal, so it is never the password itself.
SHELL_VARIABLE = re.compile(r"\$(?:[A-Za-z_]\w{0,127}|\{[A-Za-z_]\w{0,127}\})")
# redis.conf's requirepass and masterauth lines, and PowerShell's ConvertTo-SecureString "..." -AsPlainText.
REDIS_CONF = re.compile(r"(?im)(?P<label>^[ \t]*(?:requirepass|masterauth)[ \t]+)(?P<value>\S+)")
SECURE_STRING = re.compile(r"""(?i)(?P<label>ConvertTo-SecureString\s+(?:-String\s+)?)""" + QUOTED + r"""(?=[^\n]{0,256}-AsPlainText)""")
# Redaction reads this far past what a long prompt or reply keeps, so a secret that starts in the kept part is seen whole.
REDACTION_MARGIN = 64 * 1024
# A header name after "Authorization", as in ["Authorization", "ETag", "X-B3-TraceId"]: an RFC 9110 token, unless one of
# its words is a long mix of letters and digits as random tokens are. A plain default such as "N/A" or "not set".
HEADER_TOKEN = re.compile(r"[A-Za-z0-9]{1,32}(?:-[A-Za-z0-9]{1,32}){0,7}")
PLAIN_DEFAULT = re.compile(r"[<(\[]?[A-Za-z]{1,16}(?:[ /_.-][A-Za-z]{1,16}){0,4}[>)\]]?")
# A label after "Authorization" in a list of pairs, such as Django's ("authorization", "Authorization header"): two to
# five plain words.
PLAIN_PHRASE = re.compile(r"[A-Za-z]{1,16}(?: [A-Za-z]{1,16}){1,4}")
# Words a test table puts after "Authorization", as in ("Authorization", "expired"), which are not credentials.
TEST_WORDS = frozenset("invalid expired missing malformed none null empty wrong bad bogus garbage fake dummy test example "
                       "placeholder revoked unknown redacted foo bar baz".split())
# The name a call without parentheses starts with: dotted or snake_case, as in Ruby's req.add_field 'Authorization', ...;
# or a lowercase name that starts its line, as in Rack::Test's header 'Authorization', ... .
CALL_NAME = re.compile(r"(?:[A-Za-z_]\w*\.)+[A-Za-z_]\w*|[A-Za-z]\w*_\w+")
STATEMENT_NAME = re.compile(r"[a-z_]\w*")
# A literal that looks like a credential: user:password, or a run of letters and digits as tokens and base64 have.
CREDENTIAL_LIKE = re.compile(
    r"""[^\s:"'`]+:[^\s:"'`]+|(?=[A-Za-z0-9+/=_-]*[0-9])(?=[A-Za-z0-9+/=_-]*[A-Za-z])[A-Za-z0-9+/=_-]{8,}""")
LITERAL = re.compile(r"""(["'`])((?:\\.|(?!\1)[^\\\n])*)\1""")
# An interpolation in a literal: Ruby's #{...}, JavaScript's ${...}, or Python's {...}. It holds no literal text, so
# "#{user}:#{pass}" is not a credential.
INTERPOLATION = re.compile(r"[#$]?\{[^{}\n]{1,200}\}")
SCHEME_VALUE = re.compile(r"(?i)(?:Basic|Bearer|Digest|Token|Negotiate|NTLM|OAuth|ApiKey|DPoP)\s")
# Standard header names, which are never credentials, even as arguments of a call such as vary_on_headers.
KNOWN_HEADERS = frozenset("""accept accept-charset accept-encoding accept-language accept-ranges
    access-control-allow-credentials access-control-allow-headers access-control-allow-methods access-control-allow-origin
    access-control-expose-headers access-control-max-age access-control-request-headers access-control-request-method age
    allow authorization cache-control connection content-disposition content-encoding content-language content-length
    content-location content-md5 content-range content-security-policy content-type cookie date dnt etag expect expires
    forwarded from host if-match if-modified-since if-none-match if-range if-unmodified-since last-modified link location
    max-forwards origin pragma proxy-authenticate proxy-authorization range referer referrer-policy retry-after server
    set-cookie strict-transport-security te trailer transfer-encoding upgrade user-agent vary via warning www-authenticate
    x-api-key x-content-type-options x-correlation-id x-csrf-token x-csrftoken x-forwarded-for x-forwarded-host
    x-forwarded-proto x-frame-options x-http-method-override x-real-ip x-request-id x-requested-with x-total-count
    x-xss-protection""".split())
# Calls that read a header or setting, whose second argument is a default rather than a value being set.
READ_CALLS = frozenset({"get", "getheader", "get_header", "getenv", "getall", "get_all", "getlist", "get_list", "pop", "has",
                        "hasheader", "has_header", "contains", "remove", "removeheader", "remove_header", "delete"})
# Words before a bracket that make it a display rather than a call, as in: if key in ("a", "b").
DISPLAY_AFTER = frozenset({"in", "of", "not", "and", "or", "if", "else", "return", "yield", "await", "assert", "case", "is",
                           "typeof"})
# What a backward scan for the bracket around a pair stops at: quotes, so it can skip strings, and brackets.
PAIR_MARK = re.compile(r"""["'`()\[\]{}]""")
# The characters that can end or extend the expression after a bare scheme word, and the quotes that start a literal.
EXPRESSION_MARK = re.compile(r"""[()\[\]{},;#/\n"'`]""")
# ASCII control characters other than tab and line feed (carriage returns are normalized first), and runs of other
# characters, among which the remaining control and format characters such as zero-width spaces are found.
ASCII_CONTROL = re.compile(r"[\x00-\x08\x0b-\x1f\x7f]")
NON_ASCII = re.compile(r"[^\x00-\x7f]+")
# A value that holds no credential: empty, a scheme word alone, or already redacted. Only known scheme words count, since
# any other word before [REDACTED] could be part of the secret.
NO_CREDENTIAL = re.compile(
    r"""(["']?)(?:(?:Basic|Bearer|Digest|Token|Negotiate|NTLM|OAuth|ApiKey|DPoP)\b(?:\s*\[REDACTED\])?|\[REDACTED\])?\s*\1""",
    re.IGNORECASE)
# A ${{ template }} or a $( command ), read whole, so that a reference in it stays and anything else is redacted whole.
TEMPLATE = r"\$?\{\{[^{}\n]{1,200}\}\}|\$\([^()\n]{1,200}\)"
# A quoted value is redacted whole (JSON, Python, and JavaScript headers, and PHP and Ruby's =>); an unquoted one may
# carry a scheme word.
AUTHORIZATION = re.compile(r"""(?i)(?P<label>["']?authorization["']?\s*""" + SEPARATOR + r"""\s*)"""
                           r"""(?:"[^"\\\r\n]*(?:\\.[^"\\\r\n]*)*"|'[^'\\\r\n]*(?:\\.[^'\\\r\n]*)*'|(?:[A-Za-z]+\s+)?(?:""" + TEMPLATE
                           + r"""|[^\s,;"']+))""")
# Bounded parts keep a long dotted run from costing quadratic time; real schemes and URL credentials are short.
URL_PASSWORD = re.compile(r"(?i)\b([a-z][a-z0-9+.-]{0,31}://[^\s/:@]{1,256}:)[^\s/@]{1,256}(@)")
# Unquoted password values often contain spaces; redact to the end of the line.
PASSWORD_LINE = re.compile(r"""(?i)\b(pass(?:word|wd|phrase)\s*[:=]\s*)((?!["'])[^\r\n]+)""")
# The match starts at the secret word: a prefix such as DB_ or a quote before it stays in place anyway, and the scan
# skips every position that cannot begin a secret word.
NAMED_SECRET = re.compile(r"""(?i)(?P<label>""" + SECRET_WORD + r"""["']?\s*""" + SEPARATOR + r"""\s*)"""
                          r"""(?!(?:"?[\w\\]{1,128}"?:)?(?:protected|private)\])(?P<value>""" + QUOTED + "|" + TEMPLATE
                          + r"""|[^\s,;]+)""")
KNOWN_KEY = re.compile(
    r"(?<![A-Za-z0-9])(?:sk-[A-Za-z0-9_-]{16,}|sk_(?:live|test)_[A-Za-z0-9]{16,}|"
    r"gh[pousr]_[A-Za-z0-9]{15,}|github_pat_[A-Za-z0-9_]{16,}|AIza[A-Za-z0-9_-]{20,}|"
    r"(?:AKIA|ASIA)[A-Z0-9]{16}|xox[abprs]-[A-Za-z0-9-]{10,}|glpat-[A-Za-z0-9_-]{20,}|hf_[A-Za-z0-9]{30,}|"
    r"npm_[A-Za-z0-9]{36}|ya29\.[A-Za-z0-9_-]{20,}|eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})(?![A-Za-z0-9])"
)


class PromptLogError(ValueError):
    pass


def checked_project(project):
    supplied = Path(project)
    if not supplied.is_absolute():
        supplied = Path.cwd() / supplied
    for component in reversed((supplied, *supplied.parents)):
        if component.is_symlink():
            raise PromptLogError("Symlink project paths are not supported.")
        if component.exists() and not component.is_dir():
            raise PromptLogError("Project path is not a directory.")
    project = Path(os.path.abspath(supplied))
    if not project.is_dir():
        raise PromptLogError("Project directory does not exist.")
    return project


@contextmanager
def locked(project):
    """Cross-process lock. On POSIX the operating system releases it if its
    holder dies, so a killed hook can never stop logging permanently."""
    try:
        import fcntl
    except ImportError:
        fcntl = None
    if fcntl is None:
        with directory_lock(project):
            yield
        return
    try:
        fd = os.open(project / FLOCK_NAME, os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600)
    except OSError:
        raise PromptLogError("Prompt log lock must be a regular file, not a symlink.") from None
    try:
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            raise PromptLogError("Prompt log lock must be a regular file, not a symlink.")
        deadline = time.monotonic() + LOCK_TIMEOUT
        while True:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    raise PromptLogError("Prompt log is locked; no prompt was recorded.") from None
                time.sleep(0.025)
        yield
    finally:
        os.close(fd)


@contextmanager
def directory_lock(project):
    """Fallback without fcntl; a stale directory needs manual inspection."""
    lock = project / LOCK_NAME
    deadline = time.monotonic() + LOCK_TIMEOUT
    while True:
        if lock.is_symlink():
            raise PromptLogError("Prompt log lock must not be a symlink.")
        try:
            lock.mkdir(mode=0o700)
            break
        except FileExistsError:
            if not lock.is_dir() or time.monotonic() >= deadline:
                raise PromptLogError("Prompt log is locked; no prompt was recorded.") from None
            time.sleep(0.025)
    try:
        yield
    finally:
        lock.rmdir()


def check_regular(path, limit):
    try:
        info = path.lstat()
    except FileNotFoundError:
        return None
    if not stat.S_ISREG(info.st_mode) or info.st_size > limit:
        raise PromptLogError("Log or redaction input is not a bounded regular file.")
    return info


def read_bounded(path, limit):
    info = check_regular(path, limit)
    if info is None:
        return None
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    with os.fdopen(fd, "rb") as stream:
        opened = os.fstat(stream.fileno())
        if not stat.S_ISREG(opened.st_mode) or (opened.st_dev, opened.st_ino) != (info.st_dev, info.st_ino):
            raise PromptLogError("File changed while opening it.")
        content = stream.read(limit + 1)
    if len(content) > limit:
        raise PromptLogError("File exceeded its size bound.")
    return content


def ensure_unlocked(project):
    path = project / LOG_NAME
    if check_regular(path, MAX_LOG_BYTES) is not None:
        return False
    try:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
    except FileExistsError:
        check_regular(path, MAX_LOG_BYTES)
        return False
    with os.fdopen(fd, "wb") as stream:
        stream.write(HEADER.encode("utf-8"))
        stream.flush()
        os.fsync(stream.fileno())
    return True


def ensure_log(project):
    """Create the log with its header once, preserving every byte of an existing log."""
    project = checked_project(project)
    with locked(project):
        return ensure_unlocked(project)


def log_status(project):
    """A short, fixed explanation when prompts cannot be recorded, else None.

    Recording failures only reach stderr, which most hosts hide, so session
    start surfaces these persistent conditions instead.
    """
    try:
        info = check_regular(Path(project) / LOG_NAME, MAX_LOG_BYTES)
    except PromptLogError:
        return "Prompt log is full or not a regular file; archive prompt-log.md to resume recording."
    if info is not None and info.st_size + 1024 > MAX_LOG_BYTES:
        return "Prompt log is full; archive prompt-log.md to resume recording."
    for filename in ENV_FILES:
        try:
            content = read_bounded(Path(project) / filename, MAX_ENV_BYTES)
            if content is not None:
                content.decode("utf-8")
        except (OSError, ValueError):
            return "Prompt logging is paused: " + filename + " is not a bounded, readable UTF-8 regular file, so redaction cannot read it."
    return None


def parse_dotenv_line(line):
    """Return (name, literal value) for one dotenv assignment, or None.

    Shared by the logger and the Jev router so both read a file the same way.
    Values are literal: no expansion. A quoted value may be followed by a
    comment; an unterminated quote keeps the rest of the line as the value.
    """
    match = ENV_ASSIGNMENT.fullmatch(line.strip())
    if not match:
        return None
    name, value = match[1], match[2].strip()
    if value.startswith(("'", '"')):
        end = value.find(value[0], 1)
        value = value[1:] if end < 0 else value[1:end]
    else:
        value = re.split(r"\s#", value, maxsplit=1)[0].strip()
    return name, value


def configured_secrets(project, environ=None):
    """Read only named secret values from this project's dotenv files and process env."""
    environ = os.environ if environ is None else environ
    values = set()
    for name in environ:
        if SECRET_NAME.fullmatch(name):
            value = environ[name]
            if isinstance(value, str) and value:
                values.add(value)
    for filename in ENV_FILES:
        content = read_bounded(project / filename, MAX_ENV_BYTES)
        if content is None:
            continue
        for line in content.decode("utf-8").splitlines():
            parsed = parse_dotenv_line(line)
            if parsed and SECRET_NAME.fullmatch(parsed[0]) and parsed[1]:
                values.add(parsed[1])
    # Very short values such as "test" would corrupt ordinary words.
    return sorted((value for value in values if len(value) >= MIN_CONFIGURED_SECRET), key=len, reverse=True)


def redacted_window(text, secrets, keep, tail=False):
    """(redacted text, whole, count): enough of text, from its start or with tail its end, redacted so that keep
    characters or bytes can be cut from it with REDACTION_MARGIN characters to spare. The window starts with twice the
    margin, so ordinary redactions never shrink it below that. A window that redaction does shrink below it, as a long
    private key does, grows in proportion, so a secret that starts in the kept part is still seen whole, up to eight
    times its first size, which bounds the work for any paste. A window that still collapses, as a line of megabytes
    after password: does, keeps what it covers: all of it when it ends inside a redaction, or else all but the margin at
    its cut edge, where a secret may have been cut short."""
    need, size = keep + REDACTION_MARGIN, keep + 2 * REDACTION_MARGIN
    limit = 8 * size
    while True:
        whole = size >= len(text)
        clean, count = sanitize_counted(text if whole else text[-size:] if tail else text[:size], secrets)
        if whole or len(clean) >= need:
            return clean, whole, count
        if size >= limit:
            if tail:
                return clean[REDACTION_MARGIN:], False, count
            return clean if clean.rstrip().endswith(REDACTED) else clean[:max(0, len(clean) - REDACTION_MARGIN)], False, count
        size = min(limit, max(2 * size, 2 * size * need // max(len(clean), 1)))


def sanitize_prompt(prompt, secrets):
    """(text, truncated): the prompt redacted and cut to MAX_PROMPT_BYTES. Only the kept part and a margin are redacted,
    so a pasted multi-megabyte log costs about as much as a short prompt."""
    text, whole, _ = redacted_window(prompt, secrets, MAX_PROMPT_BYTES)
    encoded = text.encode("utf-8")
    if len(encoded) > MAX_PROMPT_BYTES:
        return encoded[:MAX_PROMPT_BYTES].decode("utf-8", errors="ignore"), True
    return text, not whole


def excerpt_reply(text):
    """The opening and the conclusion of a long reply, redacted before it is cut."""
    encoded = text.encode("utf-8")
    if len(encoded) <= MAX_REPLY_BYTES:
        return text, False
    half = MAX_REPLY_BYTES // 2
    head = encoded[:half].decode("utf-8", errors="ignore")
    tail = encoded[-half:].decode("utf-8", errors="ignore")
    return head + "\n[... " + str(len(encoded) - 2 * half) + " bytes omitted ...]\n" + tail, True


def redacted_reply(reply, secrets):
    """(text, truncated): the reply redacted, or for a long one its redacted opening and conclusion. A very long reply
    is redacted only around the parts it keeps, with a margin, as a prompt is; its omitted size is then counted before
    redaction."""
    half = MAX_REPLY_BYTES // 2
    head, whole, _ = redacted_window(reply, secrets, half)
    if whole:
        return excerpt_reply(head)
    head = head.encode("utf-8")[:half].decode("utf-8", errors="ignore")
    tail = redacted_window(reply, secrets, half, tail=True)[0].encode("utf-8")[-half:].decode("utf-8", errors="ignore")
    omitted = len(reply.encode("utf-8")) - len(head.encode("utf-8")) - len(tail.encode("utf-8"))
    return head + "\n[... " + str(max(omitted, 0)) + " bytes omitted ...]\n" + tail, True


def literal_credential(literal):
    """Whether a string literal looks like a credential (see CREDENTIAL_LIKE) once its interpolations, which hold no literal
    text, are removed, or holds literal text after a colon: "#{user}:#{pass}" does not, "#{user}:hunter2" does."""
    bare = INTERPOLATION.sub("", literal)
    return bool(CREDENTIAL_LIKE.search(bare)) or (":" in bare and bool(re.search(r"[A-Za-z0-9]", bare.split(":", 1)[1])))


def appends_credential(text, position):
    """Whether the expression after a bare scheme word or empty value appends what looks like the credential itself: a
    literal such as 'admin:hunter2', or after an unquoted value a token-like word. A concatenated variable, or a key such
    as 'token' in getItem('token'), does not count. The expression ends at a comma, semicolon, closing bracket, or
    comment, and at a line break unless a +, ., or backslash sits beside it, as formatters split long sums. At most 200
    characters are read."""
    end, depth, index = min(len(text), position + 200), 0, position
    while True:
        found = EXPRESSION_MARK.search(text, index, end)
        if not found:
            index = end
            break
        index, char = found.start(), found.group()
        if char in "\"'`":
            # Skip the whole literal, so a comma, bracket, or # inside it ends nothing.
            literal = LITERAL.match(text, index, end)
            if not literal:
                index = end
                break
            index = literal.end()
            continue
        if char in "([{":
            depth += 1
        elif char in ")]}":
            if not depth:
                break
            depth -= 1
        elif not depth and (char in ",;#" or text.startswith(("//", "/*"), index)):
            break
        elif char == "\n" and not depth:
            if not (text[position:index].rstrip().endswith(("+", ".", "\\")) or text[index + 1:end].lstrip().startswith(("+", "."))):
                break
        index += 1
    rest = text[position:index].strip()
    if any(literal_credential(literal.group(2)) for literal in LITERAL.finditer(rest)):
        return True
    word = re.match(r"[A-Za-z0-9+/=_-]+", rest)
    return bool(word and CREDENTIAL_LIKE.fullmatch(word.group()))


def pair_context(text, position, scans):
    """Where the quoted "Authorization" at position sits: "display" in a list, tuple, or set; "pair" in a tuple or list
    inside another, as name/value pairs are; "read" among the arguments of a call that reads a header or setting; "call"
    in any other call, an index, or a call without parentheses; or "free" in prose, with no bracket open within 160
    characters before it. scans holds how many slow backward scans this text may still make; past that, as only a
    pathological paste gets, a pair counts as sitting in a call."""
    start = max(0, position - 160)

    def opened_by(index):
        char, before = text[index], text[max(start, index - 64):index].rstrip()
        name = re.search(r"[A-Za-z_][A-Za-z0-9_]*\Z", before)
        if char == "{" or not (name or before.endswith((")", "]"))) or (name and name.group() in DISPLAY_AFTER):
            return "pair" if char in "([" and before.endswith(("[", "(", ",")) else "display"
        return "read" if char == "(" and name and name.group().lower() in READ_CALLS else "call"

    def free():
        # Spaces between a name and the quote make a call without parentheses: see CALL_NAME.
        newline = text.rfind("\n", start, position)
        line = text[newline + 1 if newline >= 0 else start:position]
        head = line.rstrip(" \t")
        name = re.search(r"[\w.]*\Z", head[-64:]).group() if len(head) < len(line) else ""
        starts_line = head.lstrip(" \t") == name and (newline >= 0 or start == 0)
        return "call" if CALL_NAME.fullmatch(name) or (starts_line and STATEMENT_NAME.fullmatch(name)) else "free"

    # Most pairs come right after their bracket.
    previous = len(text[start:position].rstrip()) + start - 1
    if previous >= start and text[previous] in "([{":
        return opened_by(previous)
    if scans[0] <= 0:
        return "call"
    scans[0] -= 1
    marks = [(found.start(), found.group()) for found in PAIR_MARK.finditer(text, start, position)]
    depth, item = 0, len(marks) - 1
    while item >= 0:
        index, char = marks[item]
        if char in "\"'`":
            # Skip back over the string this quote closes.
            item -= 1
            while item >= 0 and marks[item][1] != char:
                item -= 1
            if item < 0:
                return free()
        elif char in ")]}":
            depth += 1
        elif depth:
            depth -= 1
        else:
            return opened_by(index)
        item -= 1
    return free()


def header_name(value):
    """Whether a string reads as a header name rather than a token: see HEADER_TOKEN."""
    return bool(HEADER_TOKEN.fullmatch(value)) and not any(
        len(word) >= 8 and not word.isalpha() and not word.isdigit() for word in value.split("-"))


def redacted_form(match, scans):
    """AUTHORIZATION_FORMS' replacement. After a quoted "Authorization", the next string is a credential when it starts
    with a scheme word and a space, follows a bare scheme word that a literal is appended to, or sits in a call that sets
    a value. A standard header name never is; neither is another header name or a plain default in a list, tuple, set,
    or reading call, nor anything short of a credential-like string in prose."""
    value = match.group(0)[match.end("label") - match.start():].strip()[1:-1]
    if match["pair"] and not SCHEME_VALUE.match(value) and not NO_CREDENTIAL.fullmatch(value):
        context = pair_context(match.string, match.start("pair"), scans)
        if value.lower() in KNOWN_HEADERS or (context == "free" and not CREDENTIAL_LIKE.search(value)):
            return match.group(0)
        if context in ("display", "read") and (header_name(value) or PLAIN_DEFAULT.fullmatch(value)):
            return match.group(0)
        if context == "pair" and (PLAIN_PHRASE.fullmatch(value) or value.lower() in TEST_WORDS or (header_name(value) and "-" in value)
                                  or (PLAIN_DEFAULT.fullmatch(value) and not value.isalnum())):
            return match.group(0)
    return match["label"] + REDACTED


def unquoted(word):
    """A shell word's text, as telling a credential from a variable, a path, or a placeholder needs: its quotes of every
    kind removed and its bare escapes resolved. An escaped $ stays escaped, since it is a literal dollar rather than a
    variable, as in -p"\\$ecret", and the text inside quotes is read as written."""
    if "\\" not in word and "'" not in word and '"' not in word:
        return word

    def part(match):
        escaped = match.group(1)
        if escaped is not None:
            return "\\$" if escaped == "$" else escaped
        return next((inner for inner in match.groups()[1:] if inner is not None), "")
    return SHELL_PART.sub(part, word)


def stands_for_value(text, option=None):
    """Whether an option's value, read as text, holds no credential: nothing, punctuation, or [REDACTED], a variable
    reference, a file path, a port mapping, a placeholder such as <token>, ***, or capitals (TEXT, API_KEY), a type name
    or other word of prose (see PROSE_WORDS), or, given the option's match, a word of prose: a help description two or
    more spaces after the option, as in "  --token     Personal access token", or a lowercase word in a sentence, as in
    "Add --token support to the CLI" or "Why doesn't --token work?", whose line starts with a capital or a question word
    within 200 characters before the option, and which a word of prose or the sentence's end follows. Both are read from
    a bounded window, so a long line of options stays linear."""
    word = text.rstrip(".,;:!?)")
    if (word in ("", REDACTED) or VARIABLE_REFERENCE.fullmatch(text) or FILE_PATH.fullmatch(text) or PORT_MAPPING.fullmatch(text)
            or PLACEHOLDER.fullmatch(text) or word.lower() in PROSE_WORDS):
        return True
    if option is None or not word.isalpha():
        return False
    line, start, end = option.string, option.start(), option.end()
    after = line[end:end + 64].split("\n", 1)[0]
    if ((word.islower() or word.istitle()) and line[start:option.start("value")].endswith(("  ", "\t"))
            and re.match(r"[ \t]+[A-Za-z]", after)):
        return True
    begin = line.rfind("\n", max(0, start - 200), start) + 1
    if not word.islower() or (not begin and start > 200) or not PROSE_LINE.match(line, begin, start):
        return False
    following = after.split()
    return word != text or (bool(following) and following[0].rstrip(".,;:!?)").lower() in PROSE_WORDS)


def cookies_hold_secret(text):
    """Whether cookie text holds a cookie's value: one that is not empty, an attribute's (see COOKIE_ATTRIBUTES), a variable
    reference, nothing but interpolations, or a placeholder such as <session>. Pairs are split at semicolons and at their
    first =, so a long run without one is read once."""
    for part in text.split(";"):
        name, equals, value = part.partition("=")
        name, value = name.strip(" \t\n\"'`[],"), value.strip().strip("\"'`")
        if (equals and name and name.lower() not in COOKIE_ATTRIBUTES and INTERPOLATION.sub("", value).strip()
                and not VARIABLE_REFERENCE.fullmatch(value) and not re.fullmatch(r"<[^<>]{1,64}>", value)):
            return True
    return False


def redacted_option(option, kind):
    """An option with its value redacted (see redacted_word)."""
    return option.group(0)[:option.start("value") - option.start()] + redacted_word(option["value"], kind, option)


def redacted_word(word, kind, option=None):
    """A credential option's value with its credential redacted unless the value stands for one (see stands_for_value),
    keeping its outer quotes (see VALUE_QUOTES); given the option's match, a whole value may be a word of prose. In a
    shell word a $name is a variable the shell expands, never the password itself, unless single quotes keep it literal.
    With kind ":" or "=", only what follows the first of those is redacted, as the password in user:password or the value
    of KEY=value. "user", curl's user:password, also redacts a user that looks like a token, and a long user sent as one
    with an empty or dummy password, as in -u TOKEN:X. "cert" redacts a certificate's password after its last colon,
    unless that part is a path. With "cookie", only cookie values count, not a cookie file's name."""
    if not word:
        return word
    opening = closing = ""
    if word[0] in "\\$^\"'":
        opening, closing = next(((start, end) for start, end in VALUE_QUOTES
                                 if word.startswith(start) and word.endswith(end) and len(word) >= len(start) + len(end)), ("", ""))
    inner = word[len(opening):len(word) - len(closing)]

    def literal(raw, whole=False):
        """Whether a raw part of the value holds a credential. Only a whole value can be a word of prose; one after user: or
        pass: is a password."""
        text = unquoted(raw)
        expanded = not closing.endswith("'") and not raw.startswith(("'", "$'"))
        return not (stands_for_value(text, option if whole else None) or (expanded and SHELL_VARIABLE.fullmatch(text)))
    if kind == "cookie":
        text = unquoted(inner)
        return opening + REDACTED + closing if "=" in text and cookies_hold_secret(text) else word
    if kind == "":
        return opening + REDACTED + closing if literal(inner, whole=True) else word
    if kind == "cert":
        path, colon, secret = inner.rpartition(":")
        if not colon or not path or re.search(r"[/\\]", secret) or not literal(secret):
            return word
        return opening + path + colon + REDACTED + closing
    separator = "=" if kind == "=" else ":"
    if separator not in inner:
        return word
    user, secret = inner.split(separator, 1)
    user_text = unquoted(user)
    dummy = kind == "user" and unquoted(secret) in DUMMY_PASSWORDS
    if (kind == "user" and "@" not in user_text and not stands_for_value(user_text) and not SHELL_VARIABLE.fullmatch(user_text)
            and (TOKEN_LIKE.fullmatch(user_text) or (dummy and LONG_USER.fullmatch(user_text)))):
        user = REDACTED
    if not dummy and literal(secret):
        secret = REDACTED
    return opening + user + separator + secret + closing


def command_regions(text):
    """The spans of command lines (see COMMAND_LINE), each continued past a line break inside a quoted argument that opens
    a word, as in curl -d '{ with a JSON body on the lines after it, to the argument's closing quote (see ARGUMENT_REST)
    and the rest of its line, with those arguments' spans. An apostrophe inside a word, as in don't, opens none."""
    position = 0
    while True:
        match = COMMAND_LINE.search(text, position)
        if not match:
            return
        begin, end = match.span()
        scan, arguments = begin, []
        for _ in range(64):
            last = deque(SHELL_TOKEN.finditer(text, scan, end), maxlen=1)
            token = last[0] if last else None
            if (token is None or token["quoted"] is None or token["sq"] is not None or token["dq"] is not None
                    or token.end() != end or text[token.start() - 1] not in " \t=$"):
                break
            closing = ARGUMENT_REST[text[token.start()]].match(text, end)
            if not closing:
                break
            arguments.append((token.start(), closing.end()))
            scan, end = closing.end(), COMMAND_REST.match(text, closing.end()).end()
        yield begin, end, tuple(arguments)
        position = end


def shell_syntax(text, begin, finish, arguments):
    """The shell syntax in a command line's span (see SHELL_TOKEN), as (position, (what, span)): a closed "quoted" string, an
    "unclosed" one, a "stop", an "open", a "close", or a "tick". Each quoted argument over lines is one closed string."""
    start = begin
    for argument in arguments + ((finish, finish),):
        for token in SHELL_TOKEN.finditer(text, start, argument[0]):
            if token["quoted"] is None:
                yield token.start(), (token.lastgroup, token.span())
            else:
                yield token.start(), ("quoted" if token["sq"] is not None or token["dq"] is not None else "unclosed", token.span())
        if argument[0] < finish:
            yield argument[0], ("quoted", argument)
        start = argument[1]


def starts_quoted_command(text, quote, position):
    """Whether a listed name at position, inside the quoted string that opens at quote, starts a command there: at the
    string's start, or after an operator or line break (see QUOTED_COMMAND_START), read from at most 64 characters
    before it."""
    low = max(quote + 1, position - 64)
    return (low == quote + 1 and not text[low:position].strip()) or bool(QUOTED_COMMAND_START.search(text, low, position))


def redacted_command(text, begin, finish, arguments=()):
    """The text of a command line's span (see command_regions) with its credential options redacted (see COMMAND_OPTIONS).
    An option is judged by the nearest command named before it in the same simple command, or, when that command has no
    rule for it, by one of the two before; ssh, scp, sftp, and rsync stop that search. A simple command ends at a pipe,
    &&, ||, ;, or & outside quotes, and $( ), ( ), and backticks nest inside it, so the options after $(whoami) still
    belong to docker login (see SHELL_TOKEN). A quoted argument over lines is one string. A listed name inside a quoted
    string counts only where it starts a command, as in sh -c "mysql ...", not as a word in a header or a JSON body, and a
    name inside an option's value is none. An option's value may run past the next command's name, as a quoted password
    holding the word mysql does. Each command's subcommand is checked once, nesting deeper than 256 is not followed, and
    the shell syntax and commands are read as the options are, in order, so a line of many commands stays linear and
    small."""
    if text.find("-", begin, finish) < 0:
        return text[begin:finish]
    syntax, words = shell_syntax(text, begin, finish, arguments), COMMAND_WORD.finditer(text, begin, finish)
    token, word = next(syntax, None), next(words, None)
    scopes, recent, quoted, pieces, last = [], [], (begin, begin), [], begin
    for dash in OPTION_START.finditer(text, begin, finish):
        position = dash.start()
        while True:
            token_at, word_at = token[0] if token else finish, word.start() if word else finish
            if min(token_at, word_at) >= position:
                break
            if token_at <= word_at:
                what, span = token[1]
                if what in ("quoted", "unclosed"):
                    # A closed quoted string hides the listed names inside it; an unclosed one is likely an apostrophe.
                    quoted = span if what == "quoted" else (begin, begin)
                elif what == "stop":
                    recent = []
                elif what == "close":
                    recent = scopes.pop()[1] if scopes and scopes[-1][0] == "(" else []
                elif what == "tick" and scopes and scopes[-1][0] == "`":
                    recent = scopes.pop()[1]
                else:
                    # $( or ( opens a nested command, as does a backtick that closes none.
                    if len(scopes) < 256:
                        scopes.append(("(" if what == "open" else "`", recent))
                    recent = []
                token = next(syntax, None)
            else:
                if word_at >= last and (not quoted[0] < word_at < quoted[1] or starts_quoted_command(text, quoted[0], word_at)):
                    groups = COMMAND_OPTIONS[word.group("word")]
                    rules = tuple(rule for needs, group in groups if needs is None or needs.match(text, word.end()) for rule in group)
                    recent = (recent + [(word.group("word"), rules, bool(groups))])[-3:]
                word = next(words, None)
        if position < last:
            continue
        found, tried = None, set()
        for name, rules, listed in reversed(recent):
            if not listed:
                break
            if name in tried:
                continue
            tried.add(name)
            found = next(((option, kind) for pattern, kind in rules for option in [pattern.match(text, position)] if option), None)
            if found:
                break
        if found:
            pieces += [text[last:found[0].start()], redacted_option(*found)]
            last = found[0].end()
    return "".join(pieces) + text[last:finish]


def redacted_cookie_list(match):
    """COOKIE_LIST's replacement: every cookie object's value in the list redacted, unless it is empty or only names a
    variable."""
    def value(field):
        held = field.group(0)[field.end("label") - field.start():].strip()[1:-1]
        return field.group(0) if not held or VARIABLE_REFERENCE.fullmatch(held) else field["label"] + REDACTED
    return match.group(0)[:match.start("body") - match.start()] + COOKIE_VALUE.sub(value, match["body"])


def redacted_cookie_value(match):
    """COOKIE_VALUE's replacement outside cookie lists: the value redacted when its object holds a key only cookies have
    (see COOKIE_KEY)."""
    text = match.string
    opening = text.rfind("{", max(0, match.start() - 400), match.start())
    if opening < 0 or "}" in text[opening:match.start()]:
        return match.group(0)
    closing = text.find("}", match.end(), match.end() + 400)
    return match["label"] + REDACTED if COOKIE_KEY.search(text, opening, closing if closing >= 0 else match.end() + 400) else match.group(0)


def names_no_secret(flag, raw, head, option=None):
    """Whether a secret-named option's raw value holds no credential: it stands for one (see stands_for_value), is a shell
    variable outside single quotes, a BuildKit secret spec such as id=npmrc,src=..., a secret's name after docker's or
    podman's --secret, or a word after the --password of psql or mysql, which takes no value and only asks for one. head
    is the simple command before the option."""
    text = unquoted(raw)
    return bool(stands_for_value(text, option) or (not raw.startswith("'") and SHELL_VARIABLE.fullmatch(text))
                or (flag == "--secret" and (BUILDKIT_SECRET.match(text) or SECRET_NAMING_START.match(head)))
                or (flag in ("--password", "--passwd") and PROMPTING_START.match(head)))


def redacted_cli_secret(match):
    """CLI_SECRET's replacement: the value redacted unless it names no secret (see names_no_secret). The commands that
    matter count only where their simple command starts, on the option's line and within 300 characters before it."""
    start = match.start()
    newline = match.string.rfind("\n", max(0, start - 300), start)
    head = match.string[newline + 1:start] if newline >= 0 or start <= 300 else ""
    head = re.split(r"[;|&(`]", head)[-1]
    if names_no_secret(match["label"].strip().lower(), match["value"], head, match):
        return match.group(0)
    return match["label"] + REDACTED


def argument_lists(text):
    """Each argument list in text (see ARGUMENT_LIST and YAML_ITEM) that may hold an option, as the spans of its arguments'
    text, inside their quotes. Each list is read once, so the search stays linear."""
    if not ARGUMENT_OPTION.search(text):
        return
    position = 0
    while True:
        opening = ARGUMENT_LIST.search(text, position)
        if not opening:
            break
        spans, position = [], opening.end()
        while len(spans) < 1024:
            argument = ARGUMENT.match(text, position)
            if not argument:
                break
            spans.append(argument.span(1 if argument.group(1) is not None else 2))
            position = argument.end()
            separator = ARGUMENT_SEPARATOR.match(text, position)
            if not separator:
                break
            position = separator.end()
        if len(spans) > 1:
            yield spans
    spans, indent, end = [], None, -2
    for item in YAML_ITEM.finditer(text):
        if item["indent"] != indent or item.start() != end + 1:
            if len(spans) > 1:
                yield spans
            spans = []
        indent, end = item["indent"], item.end()
        if item["plain"] is not None:
            start = item.start("plain")
            spans.append((start, start + len(YAML_COMMENT.split(item["plain"], 1)[0].rstrip())))
        else:
            spans.append(item.span("double" if item["double"] is not None else "single"))
    if len(spans) > 1:
        yield spans


def redacted_arguments(text, spans):
    """The replacements, as (start, end, text), that redact the credentials in an argument list, given its arguments'
    spans. Each argument is a whole word. A listed command's credential option (see COMMAND_OPTIONS) takes its value
    attached or as the next argument and is judged as on a command line (see redacted_command), by the nearest of the
    last three commands before it; a secret-named option (see SECRET_OPTION) takes the next argument unless that names no
    secret (see names_no_secret). An argument starting with - is never a value."""
    words = [text[start:end] for start, end in spans]
    replacements, recent, index = [], [], 0
    while index < len(words):
        word, following = words[index], words[index + 1] if index + 1 < len(words) else None
        command = COMMAND_WORD.fullmatch(word)
        if command:
            groups = COMMAND_OPTIONS[command["word"]]
            rest = " " + " ".join(words[index + 1:index + 8])
            rules = tuple(rule for needs, group in groups if needs is None or needs.match(rest) for rule in group)
            recent = (recent + [(command["word"], rules, bool(groups))])[-3:]
        elif word.startswith("-"):
            value, tried = None, set()
            for name, rules, listed in reversed(recent):
                if not listed or value:
                    break
                if name in tried:
                    continue
                tried.add(name)
                for pattern, kind in rules:
                    attached = pattern.match(word)
                    spaced = following and pattern.match(word + " " + following)
                    if attached and attached.start("value") < len(word):
                        value = (index, attached.start("value"), kind)
                    elif spaced and spaced.start("value") == len(word) + 1:
                        value = (index + 1, 0, kind)
                    if value:
                        break
            if value:
                position, offset, kind = value
                raw = words[position][offset:]
                result = redacted_word(raw, kind)
                if result != raw:
                    replacements.append((spans[position][0] + offset, spans[position][1], result))
                index = position
            elif (following and not following.startswith("-") and SECRET_OPTION.fullmatch(word)
                    and not names_no_secret(word.lower(), following, " ".join(words[:index]) + " ")):
                replacements.append((spans[index + 1][0], spans[index + 1][1], REDACTED))
                index += 1
        index += 1
    return replacements


def sanitize_counted(text, secrets):
    """(redacted text, number of values replaced). A value that already reads [REDACTED] is not counted,
    so callers can tell whether this text held anything to redact, whatever markers it already contained."""
    changed = 0

    def substitute(pattern, replacement, text):
        def apply(match):
            nonlocal changed
            # A value with no credential in it stays as written and is not counted: one already redacted, or an empty
            # value or bare scheme word that nothing on the line appends a credential to.
            if "label" in match.re.groupindex:
                value = match.group(0)[match.end("label") - match.start():].strip()
                if len(value) <= 64 and NO_CREDENTIAL.fullmatch(value) and (
                        "[REDACTED]" in value.upper() or not appends_credential(match.string, match.end())):
                    return match.group(0)
                if len(value) <= 256 and (VARIABLE_REFERENCE.fullmatch(value) or FILE_PATH.fullmatch(value)):
                    return match.group(0)
            result = replacement(match) if callable(replacement) else match.expand(replacement)
            changed += result.replace('"', "").replace("'", "") != match.group(0).replace('"', "").replace("'", "")
            return result
        return pattern.sub(apply, text)

    def redact_commands(text):
        nonlocal changed
        pieces, last = [], 0
        for begin, finish, arguments in command_regions(text):
            result = redacted_command(text, begin, finish, arguments)
            changed += result != text[begin:finish]
            pieces += [text[last:begin], result]
            last = finish
        return "".join(pieces) + text[last:]

    def redact_arguments(text):
        nonlocal changed
        pieces, last = [], 0
        for start, end, result in sorted(replacement for spans in argument_lists(text) for replacement in redacted_arguments(text, spans)):
            if start >= last:
                pieces += [text[last:start], result]
                last = end
                changed += 1
        return "".join(pieces) + text[last:]

    def replace_values(text):
        nonlocal changed
        for value in secrets:
            changed += text.count(value)
            text = text.replace(value, REDACTED)
        return text
    # Exact configured values are replaced before and after normalization, and
    # patterns run on normalized text: an invisible character inside a key must
    # not hide it from a pattern and then be stripped to rebuild the key.
    text = replace_values(text)
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = ASCII_CONTROL.sub("", text)
    # Control and format characters are never printable, so most text skips the per-character check.
    if not text.isascii() and not text.replace("\n", "").replace("\t", "").isprintable():
        text = NON_ASCII.sub(lambda run: run.group() if run.group().isprintable() else "".join(
            char for char in run.group() if unicodedata.category(char) not in {"Cc", "Cf"}), text)
    text = replace_values(text)
    text = substitute(PRIVATE_KEY, REDACTED, text)
    text = substitute(URL_PASSWORD, r"\1" + REDACTED + r"\2", text)
    scans = [2000]
    text = substitute(AUTHORIZATION_FORMS, lambda match: redacted_form(match, scans), text)
    for pattern in (VALUE_FIRST, YAML_ENV, YAML_DIFF_VALUE, YAML_ENV_VALUE_FIRST, YAML_FLOW, PHP_DUMP, REDIS_CONF, SECURE_STRING,
                    NET_COOKIE, JAR_COOKIE, AUTHORIZATION):
        text = substitute(pattern, lambda match: match["label"] + REDACTED, text)
    for pattern in (COOKIE_ARRAY, COOKIE_HEADER):
        text = substitute(pattern, lambda match: match["label"] + REDACTED if cookies_hold_secret(match["value"]) else match.group(0),
                          text)
    if "cookie" in text.lower():
        text = substitute(COOKIE_LIST, redacted_cookie_list, text)
        text = substitute(COOKIE_VALUE, redacted_cookie_value, text)
    text = substitute(BEARER, lambda match: match[1] + " " + REDACTED, text)
    text = redact_commands(text)
    text = redact_arguments(text)
    text = substitute(CLI_SECRET, redacted_cli_secret, text)
    text = substitute(PASSWORD_LINE, lambda match: match.group(0) if VARIABLE_REFERENCE.fullmatch(match[2].strip())
                      else match[1] + REDACTED, text)
    text = substitute(NAMED_SECRET, lambda match: match["label"] + REDACTED, text)
    return substitute(KNOWN_KEY, REDACTED, text), changed


def identifier(value):
    if not isinstance(value, str) or not value or len(value) > 512:
        raise PromptLogError("Prompt metadata needs bounded string identifiers.")
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def metadata(payload, harness):
    if harness not in HARNESSES or not isinstance(payload, dict) or not isinstance(payload.get("prompt"), str):
        raise PromptLogError("A supported harness and prompt string are required.")
    kind = payload.get("text_kind", "verbatim_redacted")
    if kind not in TEXT_KINDS:
        raise PromptLogError("Unsupported prompt text kind.")
    session = payload.get("session_id") or payload.get("conversation_id")
    session_hash = identifier(session) if session is not None else "unspecified"
    event = next((payload[field] for field in TURN_FIELDS if payload.get(field)), None)
    if event is not None:
        identifier(event)
    stable = event is not None and session is not None
    receipt = hashlib.sha256((session_hash + "\0" + event).encode("utf-8")).hexdigest() if stable else uuid.uuid4().hex
    return {"id": receipt, "session_id": session_hash, "harness": harness, "text_kind": kind, "role": "user"}, stable


def reply_metadata(payload, harness, clean):
    """(entry, stable) for a reply whose logged text, redacted and perhaps cut to its opening and conclusion, is clean.

    The ID hashes that text, never the reply itself, so a shared log cannot be used to test guesses at a redacted
    value. Only a reply within a known turn is deduplicated; without a turn ID, a repeated 'Done.' is a new reply.
    """
    if harness not in HARNESSES or not isinstance(payload, dict):
        raise PromptLogError("A supported harness and reply payload are required.")
    session = payload.get("session_id") or payload.get("conversation_id")
    session_hash = identifier(session) if session is not None else "unspecified"
    turn = next((payload[field] for field in TURN_FIELDS if payload.get(field)), None)
    if turn is not None:
        identifier(turn)
    # The prompt entry for the same turn has this ID, so a reply points at the prompt it answers.
    prompt = hashlib.sha256((session_hash + "\0" + turn).encode("utf-8")).hexdigest() if session is not None and turn is not None else None
    stable = session is not None and turn is not None
    digest = hashlib.sha256(clean.encode("utf-8")).hexdigest()
    receipt = hashlib.sha256((session_hash + "\0" + turn + "\0reply\0" + digest).encode("utf-8")).hexdigest() if stable else uuid.uuid4().hex
    return ({"id": receipt, "session_id": session_hash, "harness": harness, "text_kind": "verbatim_redacted", "role": "assistant",
             "reply_to": prompt}, stable)


def contains_entry(content, receipt):
    """Only markers outside fenced text count; prompts cannot forge receipts."""
    fence = None
    for line in content.splitlines():
        if fence:
            if re.fullmatch(re.escape(fence[0]) + "{" + str(fence[1]) + r",}\s*", line):
                fence = None
            continue
        opening = re.match(r"^(`{3,}|~{3,})(?:[^`~]*)$", line)
        if opening:
            fence = (opening[1][0], len(opening[1]))
            continue
        if not line.startswith("<!-- prompt-log-entry ") or not line.endswith(" -->"):
            continue
        try:
            entry = json.loads(line[len("<!-- prompt-log-entry "):-len(" -->")])
        except ValueError:
            continue
        if isinstance(entry, dict) and entry.get("id") == receipt:
            return True
    return False


def append_prompt(project, payload, harness="portable", *, environ=None):
    """Append one sanitized prompt; only stable session/event IDs deduplicate."""
    project = checked_project(project)
    entry, stable = metadata(payload, harness)
    text, truncated = sanitize_prompt(payload["prompt"], configured_secrets(project, environ))
    entry["truncated"] = truncated
    return write_entry(project, entry, stable, text)


def append_reply(project, payload, harness="portable", *, environ=None):
    """Append the agent's sanitized reply, linked to its prompt; a payload without one records nothing."""
    project = checked_project(project)
    if harness not in HARNESSES or not isinstance(payload, dict):
        raise PromptLogError("A supported harness and reply payload are required.")
    reply = payload.get(REPLY_FIELDS[harness])
    if not isinstance(reply, str) or not reply.strip():
        return {"status": "skipped"}
    text, truncated = redacted_reply(reply, configured_secrets(project, environ))
    entry, stable = reply_metadata(payload, harness, text)
    entry["truncated"] = truncated
    return write_entry(project, entry, stable, text, " | agent reply")


def write_entry(project, entry, stable, text, label=""):
    longest = max((len(run) for run in re.findall(r"`+", text)), default=0)
    fence = "`" * max(3, longest + 1)
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    addition = ("\n\n## " + timestamp + " | " + entry["id"] + label + "\n\n"
                "<!-- prompt-log-entry " + json.dumps(entry, separators=(",", ":")) + " -->\n\n"
                + fence + "text\n" + text + ("" if text.endswith("\n") else "\n") + fence + "\n")
    encoded = addition.encode("utf-8")
    with locked(project):
        path = project / LOG_NAME
        current = read_bounded(path, MAX_LOG_BYTES)
        if current is not None:
            if stable and contains_entry(current.decode("utf-8"), entry["id"]):
                return {"status": "duplicate", "id": entry["id"]}
        else:
            current = HEADER.encode("utf-8")
        if len(current) + len(encoded) > MAX_LOG_BYTES:
            raise PromptLogError("Prompt log is full; no prompt was recorded.")
        ensure_unlocked(project)
        info = check_regular(path, MAX_LOG_BYTES)
        fd = os.open(path, os.O_WRONLY | os.O_APPEND | getattr(os, "O_NOFOLLOW", 0))
        with os.fdopen(fd, "ab") as stream:
            opened = os.fstat(stream.fileno())
            if not stat.S_ISREG(opened.st_mode) or (opened.st_dev, opened.st_ino, opened.st_size) != (info.st_dev, info.st_ino, len(current)):
                raise PromptLogError("Prompt log changed during recording.")
            stream.write(encoded)
            stream.flush()
            os.fsync(stream.fileno())
    return {"status": "recorded", "id": entry["id"]}


def read_payload(stream):
    raw = stream.read(MAX_INPUT_BYTES + 1)
    if len(raw) > MAX_INPUT_BYTES:
        raise PromptLogError("Prompt input exceeds its size bound.")
    payload = json.loads(raw)
    if not isinstance(payload, dict):
        raise PromptLogError("Prompt input must be a JSON object.")
    return payload


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("init", "record", "hook", "reply"),
                        help="hook and record log a prompt; reply logs the agent's reply from a Stop or afterAgentResponse payload")
    parser.add_argument("--project-root", type=Path, default=Path.cwd())
    parser.add_argument("--package-root", type=Path, help="accepted for shared bootstrap compatibility; unused")
    parser.add_argument("--harness", choices=HARNESSES, default="portable")
    args = parser.parse_args(argv)
    try:
        if args.action == "init":
            result = {"status": "created" if ensure_log(args.project_root) else "exists"}
        elif args.action == "reply":
            result = append_reply(args.project_root, read_payload(sys.stdin.buffer), args.harness)
        else:
            result = append_prompt(args.project_root, read_payload(sys.stdin.buffer), args.harness)
    except (OSError, ValueError, TypeError, UnicodeError, RecursionError):
        print("Conversation logging unavailable; no prompt, reply, or credential details were reported. Continue normally.", file=sys.stderr)
        result = {"status": "unavailable"}
    # Hooks never block: Cursor's beforeSubmitPrompt needs continue, and Stop hooks need a JSON object.
    if args.action in {"hook", "reply"} and args.harness != "portable":
        result = {"continue": True} if args.harness == "cursor" and args.action == "hook" else {}
    print(json.dumps(result, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    sys.exit(main())
