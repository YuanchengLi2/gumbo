"""Windows AppContainer compatibility for private temporary directories.

Python 3.13's Windows mkdir(0700) replaces the inherited DACL with a user-only
DACL. An AppContainer token requires BOTH that user and its package SID. Keep
the project-specific inherited DACL instead, preserving the OS sandbox boundary.
This module is bundled only in Dream's creation Python, never installed globally.
"""
import os
import ctypes
from ctypes import wintypes

def _in_appcontainer():
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    advapi = ctypes.WinDLL("advapi32", use_last_error=True)
    kernel.GetCurrentProcess.restype = wintypes.HANDLE
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    advapi.OpenProcessToken.argtypes = [wintypes.HANDLE, wintypes.DWORD, ctypes.POINTER(wintypes.HANDLE)]
    advapi.GetTokenInformation.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(wintypes.DWORD)]
    token = wintypes.HANDLE()
    value = wintypes.DWORD()
    size = wintypes.DWORD()
    if not advapi.OpenProcessToken(kernel.GetCurrentProcess(), 0x0008, ctypes.byref(token)):
        return False
    try:
        return bool(advapi.GetTokenInformation(token, 29, ctypes.byref(value), ctypes.sizeof(value), ctypes.byref(size)) and value.value)
    finally:
        kernel.CloseHandle(token)

if os.name == "nt" and _in_appcontainer():
    _mkdir = os.mkdir
    def _container_mkdir(path, mode=0o777, *, dir_fd=None):
        return _mkdir(path, 0o777 if mode == 0o700 else mode, dir_fd=dir_fd)
    os.mkdir = _container_mkdir
    # Windows substitutes an AppContainer profile temp path on process startup.
    # Use the explicitly granted project cache and extended paths so pip works
    # in deeply nested project folders without changing machine registry policy.
    if os.environ.get("DREAM_TEMP"):
        _temp = os.environ["DREAM_TEMP"]
        os.makedirs(_temp, exist_ok=True)
        os.environ["TEMP"] = os.environ["TMP"] = _temp
