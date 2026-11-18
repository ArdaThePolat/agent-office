"""The jukebox's source: what macOS's Now Playing shows, from any app (Spotify, Music, a video in
Chrome or Safari, a podcast app), and its previous / play-pause / next.

Jukebox.swift runs this with Apple's own python3, the one the build already needs: macOS gives Now
Playing (the MediaRemote framework) only to Apple-signed programs, so the app's own binary cannot
ask. Standard library only; it talks to the framework through ctypes.

stdout: one JSON object per line whenever what is playing changes:
  {"app": bundle id, "name": app name, "playing": bool, "title", "artist", "album",
   "duration", "elapsed", "at": the time `elapsed` was read, "key": what identifies the item,
   "art": the cover as base64 (only on the first line for a key that has one)}
  {"app": ""} when nothing is playing.
stdin: one command per line, "playpause", "next" or "previous". The helper exits when stdin
closes, so it never outlives the app.

It wakes on Now Playing's change notifications, and at most every POLL seconds as a backstop.
"""

import base64, ctypes, json, os, sys, threading, time
from typing import Any

POLL = 5.0
COMMANDS = {"playpause": 2, "next": 4, "previous": 5}     # MRMediaRemoteCommand

objc = ctypes.cdll.LoadLibrary("/usr/lib/libobjc.A.dylib")
libsys = ctypes.cdll.LoadLibrary("/usr/lib/libSystem.dylib")
cf = ctypes.cdll.LoadLibrary("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation")
ctypes.cdll.LoadLibrary("/System/Library/Frameworks/Foundation.framework/Foundation")
mr = ctypes.cdll.LoadLibrary("/System/Library/PrivateFrameworks/MediaRemote.framework/MediaRemote")

V = ctypes.c_void_p
objc.objc_getClass.restype = V
objc.sel_registerName.restype = V
_send: Any = ctypes.cast(objc.objc_msgSend, V).value


def send(obj, sel, *args, restype: Any = V, argtypes=()):
    f = ctypes.CFUNCTYPE(restype, V, V, *argtypes)(_send)
    return f(obj, objc.sel_registerName(sel.encode()), *args)


def nsstring(s):
    return send(objc.objc_getClass(b"NSString"), "stringWithUTF8String:", s.encode(), argtypes=(ctypes.c_char_p,))


def pystr(o):
    if not o:
        return ""
    p = send(o, "UTF8String", restype=ctypes.c_char_p)
    return p.decode("utf-8", "replace") if p else ""


def pynum(o):
    return send(o, "doubleValue", restype=ctypes.c_double) if o else 0.0


# Objective-C blocks by hand (the block ABI): a global block needs no copy or dispose helpers.
class _Desc(ctypes.Structure):
    _fields_ = [("reserved", ctypes.c_ulong), ("size", ctypes.c_ulong)]


_blocks = []                                               # kept alive for the process's life


def block(fn, *argtypes):
    cb_t = ctypes.CFUNCTYPE(None, V, *argtypes)

    class Block(ctypes.Structure):
        _fields_ = [("isa", V), ("flags", ctypes.c_int), ("reserved", ctypes.c_int),
                    ("invoke", cb_t), ("desc", ctypes.POINTER(_Desc))]

    cb, desc = cb_t(lambda _blk, *a: fn(*a)), _Desc(0, ctypes.sizeof(Block))
    b = Block(ctypes.addressof(V.in_dll(libsys, "_NSConcreteGlobalBlock")), 1 << 28, 0, cb, ctypes.pointer(desc))
    _blocks.append((b, cb, desc))
    return ctypes.addressof(b)


MAIN_Q = ctypes.addressof(V.in_dll(libsys, "_dispatch_main_q"))
for name, args in [("MRMediaRemoteGetNowPlayingInfo", (V, V)), ("MRMediaRemoteGetNowPlayingClient", (V, V)),
                   ("MRMediaRemoteGetNowPlayingApplicationIsPlaying", (V, V)),
                   ("MRMediaRemoteRegisterForNowPlayingNotifications", (V,)), ("MRMediaRemoteSendCommand", (ctypes.c_int, V))]:
    getattr(mr, name).argtypes = args
for name in ["MRNowPlayingClientGetBundleIdentifier", "MRNowPlayingClientGetParentAppBundleIdentifier",
             "MRNowPlayingClientGetDisplayName"]:
    getattr(mr, name).restype = V
    getattr(mr, name).argtypes = (V,)
cf.CFRunLoopRunInMode.argtypes = (V, ctypes.c_double, ctypes.c_bool)
RUN_MODE = V.in_dll(cf, "kCFRunLoopDefaultMode")

K = {k: nsstring("kMRMediaRemoteNowPlayingInfo" + k) for k in
     ["Title", "Artist", "Album", "Duration", "ElapsedTime", "Timestamp", "ArtworkData"]}

pending = {}                 # the three answers of one refresh, filled by the blocks below
dirty = threading.Event()
last: dict[str, Any] = {"line": None, "key": None, "art_key": None}
out_lock = threading.Lock()


def on_info(info):
    item = {}
    if info:
        get = lambda k: send(info, "objectForKey:", K[k], argtypes=(V,))
        item = {"title": pystr(get("Title")), "artist": pystr(get("Artist")), "album": pystr(get("Album")),
                "duration": round(pynum(get("Duration")), 1), "elapsed": round(pynum(get("ElapsedTime")), 1)}
        ts = get("Timestamp")                              # an NSDate: when elapsed was measured
        item["at"] = round(send(ts, "timeIntervalSince1970", restype=ctypes.c_double), 1) if ts else time.time()
        art = get("ArtworkData")
        if art:
            n = send(art, "length", restype=ctypes.c_ulong)
            if 0 < n < 8_000_000:
                item["artData"] = ctypes.string_at(send(art, "bytes"), n)
    pending["info"] = item
    finish()


def on_client(client):
    app = name = ""
    if client:
        c = V(client)
        app = pystr(mr.MRNowPlayingClientGetParentAppBundleIdentifier(c)) or pystr(mr.MRNowPlayingClientGetBundleIdentifier(c))
        name = pystr(mr.MRNowPlayingClientGetDisplayName(c))
    pending["client"] = (app, name)
    finish()


def on_playing(playing):
    pending["playing"] = bool(playing)
    finish()


INFO_B, CLIENT_B, PLAYING_B = block(on_info, V), block(on_client, V), block(on_playing, ctypes.c_bool)


def refresh():
    pending.clear()
    mr.MRMediaRemoteGetNowPlayingInfo(MAIN_Q, INFO_B)
    mr.MRMediaRemoteGetNowPlayingClient(MAIN_Q, CLIENT_B)
    mr.MRMediaRemoteGetNowPlayingApplicationIsPlaying(MAIN_Q, PLAYING_B)


def emit(obj):
    with out_lock:
        sys.stdout.write(json.dumps(obj, separators=(",", ":")) + "\n")
        sys.stdout.flush()


def finish():
    if len(pending) < 3:
        return
    info, (app, name), playing = pending["info"], pending["client"], pending["playing"]
    if not app or not (info.get("title") or info.get("artist")):
        if last["line"] != "":
            last.update(line="", key=None, art_key=None)
            emit({"app": ""})
        return
    # the item is what it shows, not the player's item id: some players hand out a new id with a
    # pause or a new artwork size, and the cover is sent once per key
    key = "|".join([app, info["title"], info["artist"], info["album"]])
    line = {"app": app, "name": name or app, "playing": playing, "key": key,
            **{k: info[k] for k in ["title", "artist", "album", "duration", "elapsed", "at"]}}
    # what is new: anything but the clock, or a jump of the clock (a seek)
    same = {k: v for k, v in line.items() if k not in ("elapsed", "at")}
    prev = last["line"] or {}
    drift = abs((line["elapsed"] - line["at"]) - (prev.get("elapsed", 0) - prev.get("at", 0))) if prev and playing else 0
    send_art = info.get("artData") and last["art_key"] != key
    if same == {k: v for k, v in prev.items() if k not in ("elapsed", "at")} and drift < 2 and not send_art:
        return
    if send_art:
        line["art"] = base64.b64encode(info["artData"]).decode()
        last["art_key"] = key
    last.update(line={k: v for k, v in line.items() if k != "art"}, key=key)
    emit(line)


def on_note(_note):
    dirty.set()


def commands():
    for raw in sys.stdin:
        c = COMMANDS.get(raw.strip())
        if c is not None:
            mr.MRMediaRemoteSendCommand(c, None)
            dirty.set()
    os._exit(0)                                            # the app is gone


def main():
    mr.MRMediaRemoteRegisterForNowPlayingNotifications(MAIN_Q)
    center = send(objc.objc_getClass(b"NSNotificationCenter"), "defaultCenter")
    note_b = block(on_note, V)
    for n in ["kMRMediaRemoteNowPlayingInfoDidChangeNotification",
              "kMRMediaRemoteNowPlayingApplicationIsPlayingDidChangeNotification",
              "kMRMediaRemoteNowPlayingApplicationDidChangeNotification"]:
        send(center, "addObserverForName:object:queue:usingBlock:", nsstring(n), None, None, note_b,
             argtypes=(V, V, V, V))
    threading.Thread(target=commands, daemon=True).start()
    next_poll = 0.0
    while True:
        now = time.monotonic()
        if dirty.is_set() or now >= next_poll:
            dirty.clear()
            refresh()
            next_poll = now + POLL
        cf.CFRunLoopRunInMode(RUN_MODE, 0.3, False)


if __name__ == "__main__":
    main()
