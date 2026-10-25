# Runs participant code and task tests inside Pyodide.
# Kept small on purpose; the JS side handles timeouts by killing the worker.
import builtins
import contextlib
import io
import json
import sys
import traceback

MAX_OUTPUT = 20000


def _no_input(*args, **kwargs):
    raise RuntimeError("input() is not available here, call the function directly instead")


def _namespace(name):
    return {"__name__": name, "__builtins__": builtins, "input": _no_input}


def _format_error():
    etype, value, tb = sys.exc_info()
    frames = [f for f in traceback.extract_tb(tb) if f.filename == "main.py"]
    lines = []
    if frames:
        lines.append("Traceback (most recent call last):")
        for f in frames:
            lines.append(f'  File "main.py", line {f.lineno}, in {f.name}')
            if f.line:
                lines.append(f"    {f.line.strip()}")
    lines.extend(s.rstrip("\n") for s in traceback.format_exception_only(etype, value))
    return "\n".join(lines)


def _short_error(e):
    return f"{type(e).__name__}: {e}" if str(e) else type(e).__name__


def run_program(code):
    out = io.StringIO()
    error = None
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
        try:
            exec(compile(code, "main.py", "exec"), _namespace("__main__"))
        except BaseException:
            error = _format_error()
    return json.dumps({"stdout": out.getvalue()[:MAX_OUTPUT], "error": error})


def run_tests(code, tests_json):
    tests = json.loads(tests_json)
    try:
        compiled = compile(code, "main.py", "exec")
    except SyntaxError:
        msg = _format_error()
        results = [
            {**t, "actual": "SyntaxError", "passed": False, "error": msg}
            for t in tests
        ]
        return json.dumps({"results": results, "error": msg})

    results = []
    for t in tests:
        ns = _namespace("__calibra_test__")
        out = io.StringIO()
        row = {**t, "passed": False}
        try:
            with contextlib.redirect_stdout(out):
                exec(compiled, ns)
                value = eval(t["call"], ns)
            expected = eval(t["expected"], {})
            row["actual"] = repr(value)
            row["passed"] = value == expected and type(value) is type(expected)
        except BaseException as e:
            row["actual"] = _short_error(e)
            row["error"] = _format_error()
        row["stdout"] = out.getvalue()[:2000]
        results.append(row)
    return json.dumps({"results": results, "error": None})


def evaluate(code, call):
    # Used by the task validation tests to check prediction answers.
    ns = _namespace("__calibra_test__")
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            exec(compile(code, "main.py", "exec"), ns)
            return repr(eval(call, ns))
    except BaseException as e:
        return type(e).__name__
