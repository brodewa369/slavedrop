#!/usr/bin/env python3
"""CDP debug harness for SlaveDrop mobile-UI work.

Runs the Electron debug shell (which loads the UNMODIFIED SlaveDrop renderer),
then drives Android viewport/touch emulation over CDP.

  python3 mdebug.py launch       # start shell + mobile emulation
  python3 mdebug.py status       # viewport, app state, errors
  python3 mdebug.py errors       # console errors only
  python3 mdebug.py eval "<js>"  # evaluate JS in the page
  python3 mdebug.py tap <x> <y>  # synthetic touch tap
  python3 mdebug.py shot <out>   # screenshot (png)
  python3 mdebug.py stop         # kill shell
"""
import base64, json, os, subprocess, sys, time, urllib.request

import websocket

ROOT = os.path.dirname(os.path.abspath(__file__))
HARNESS = os.path.join(ROOT, "harness")
PORT = 9333
DEVNULL = subprocess.DEVNULL


# ---------- CDP plumbing ----------
def get_targets():
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json", timeout=3) as r:
            return json.load(r)
    except Exception:
        return None


def page_target():
    for t in get_targets() or []:
        if t.get("type") == "page":
            return t
    return None


def connect():
    t = page_target()
    if not t:
        return None
    ws = websocket.create_connection(t["webSocketDebuggerUrl"], timeout=10,
                                     suppress_origin=True)
    return ws


_mid = [0]
def cmd(ws, method, **params):
    _mid[0] += 1
    ws.send(json.dumps({"id": _mid[0], "method": method, "params": params}))
    while True:
        msg = json.loads(ws.recv())
        if msg.get("id") == _mid[0]:
            return msg.get("result", {})


def evaluate(ws, expr):
    # Wrap in async IIFE if it contains await or returns a Promise
    wrapped = expr
    r = cmd(ws, "Runtime.evaluate", expression=wrapped, returnByValue=True, awaitPromise=True)
    res = r.get("result", {})
    if r.get("exceptionDetails"):
        return "JS-ERROR: " + json.dumps(r["exceptionDetails"])[:500]
    return res.get("value")


# ---------- mobile emulation ----------
def emulate_mobile(ws, w=390, h=844, dsf=1.0):
    cmd(ws, "Emulation.setDeviceMetricsOverride", width=w, height=h,
        deviceScaleFactor=dsf, mobile=True, screenWidth=w, screenHeight=h)
    cmd(ws, "Emulation.setTouchEmulationEnabled", enabled=True, maxTouchPoints=5)
    # Android webview UA (Pixel 6 / Android 15)
    ua = ("Mozilla/5.0 (Linux; Android 15; Pixel 6 Build/AP3A.240905.015.A2) "
          "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Mobile "
          "Safari/537.36")
    cmd(ws, "Emulation.setUserAgentOverride", userAgent=ua,
        platform="Linux armv8l", userAgentMetadata={})
    cmd(ws, "Emulation.setEmulatedMedia", features=[{"name": "prefers-color-scheme", "value": "dark"}])


# ---------- commands ----------
def launch():
    if get_targets():
        print(f"shell already running on :{PORT}")
        return
    subprocess.Popen(
        ["npx", "electron", HARNESS, f"--remote-debugging-port={PORT}",
         "--remote-allow-origins=*",
         "--no-sandbox"],
        cwd="/home/dxwx/slavedrop-mobile",
        stdout=DEVNULL, stderr=subprocess.PIPE, text=True)
    for _ in range(90):
        if get_targets():
            break
        time.sleep(0.5)
    ws = connect()
    if not ws:
        print("FAILED: no page target after 45s")
        return
    emulate_mobile(ws)
    # wait for app bootstrap, then check
    for _ in range(40):
        state = evaluate(ws, "window.__harnessState || (window.__harnessState = 'check', null)")
        break
    time.sleep(3)
    status(ws)
    ws.close()


def status(ws):
    print("== viewport ==")
    print(evaluate(ws, "JSON.stringify({innerWidth, innerHeight, devicePixelRatio, "
                       "touch: 'ontouchstart' in window, coarse: matchMedia('(pointer:coarse)').matches, "
                       "ua: navigator.userAgent.slice(0,70)})"))
    print("== app ==")
    print(evaluate(ws, "JSON.stringify({"
                       "hasApi: !!window.api, apiKeys: Object.keys(window.api||{}).length, "
                       "projects: (document.querySelectorAll('.project, [data-project], .proj, .card').length)||0, "
                       "title: document.title, bodyScrollH: document.body.scrollHeight, "
                       "horizOverflow: document.documentElement.scrollWidth > innerWidth})"))
    print("== errors ==")
    print(errors(ws))


ERRORS_EXPR = """
(() => {
  if (!window.__errs) {
    window.__errs = [];
    window.addEventListener('error', e => window.__errs.push('ERR: ' + (e.message||'').slice(0,160)));
    const _ce = console.error; console.error = (...a) => { window.__errs.push('CONSOLE.ERROR: ' + a.join(' ').slice(0,160)); _ce.apply(console,a); };
  }
  const e = window.__errs.slice(-8);
  return e.length ? e.join('\\n') : '(none)';
})()
"""


def errors(ws):
    return evaluate(ws, ERRORS_EXPR)


def main():
    a = sys.argv[1:]
    if not a:
        print(__doc__)
        return
    op = a[0]
    if op == "launch":
        launch(); return
    if op == "stop":
        subprocess.run(["pkill", "-f", f"remote-debugging-port={PORT}"], stdout=DEVNULL, stderr=DEVNULL)
        print("stopped"); return
    ws = connect()
    if not ws:
        print("no shell — run: python3 mdebug.py launch"); return
    try:
        if op == "status":
            status(ws)
        elif op == "errors":
            print(errors(ws))
        elif op == "eval":
            print(evaluate(ws, a[1]))
        elif op == "tap":
            x, y = float(a[1]), float(a[2])
            common = dict(x=x, y=y, radiusX=1, radiusY=1, force=1)
            cmd(ws, "Input.dispatchTouchEvent", type="touchStart",
                touchPoints=[{**common, "id": 1}])
            cmd(ws, "Input.dispatchTouchEvent", type="touchEnd", touchPoints=[])
            print(f"tap {x},{y}")
        elif op == "shot":
            r = cmd(ws, "Page.captureScreenshot", format="png")
            with open(a[1], "wb") as f:
                f.write(base64.b64decode(r["data"]))
            print("saved", a[1])
        else:
            print("unknown op:", op, "\n", __doc__)
    finally:
        ws.close()


if __name__ == "__main__":
    main()
